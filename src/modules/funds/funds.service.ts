import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { share, toRupees } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AccountType, ProjectStatus } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import {
  CreateFundDto,
  FundBreakdownLineDto,
  FundRecordDto,
  FundRefDto,
  QueryFundsDto,
  UpdateFundDto,
} from './dto/fund.dto';

type FundRow = Prisma.FundGetPayload<Record<string, never>>;

export function toFundRef(fund: Pick<FundRow, 'id' | 'nameTa' | 'nameEn'>): FundRefDto {
  return { id: fund.id, name: fund.nameEn ?? fund.nameTa, nameTa: fund.nameTa };
}

interface Movement {
  income: number;
  expenses: number;
  entryCount: number;
}

@Injectable()
export class FundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerQueryService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryFundsDto): Promise<FundRecordDto[]> {
    const funds = await this.prisma.fund.findMany({
      where: { isActive: query.isActive },
      orderBy: { nameTa: 'asc' },
    });

    const [movement, projects] = await Promise.all([
      this.movementByFund(query.financialYearId),
      this.prisma.project.groupBy({
        by: ['fundId'],
        _count: { _all: true },
        _sum: { budget: true },
      }),
    ]);

    const byFund = new Map(projects.map((row) => [row.fundId, row]));

    return funds.map((fund) => {
      const stats = byFund.get(fund.id);

      return this.toRecord(
        fund,
        movement.get(fund.id),
        stats?._count._all ?? 0,
        toRupees(stats?._sum.budget),
      );
    });
  }

  async findOneOrFail(id: number, financialYearId?: number): Promise<FundRecordDto> {
    const fund = await this.prisma.fund.findUnique({ where: { id } });

    if (!fund) throw new NotFoundException(`Fund ${id} was not found`);

    const [movement, stats] = await Promise.all([
      this.movementByFund(financialYearId),
      this.prisma.project.aggregate({
        where: { fundId: id },
        _count: { _all: true },
        _sum: { budget: true },
      }),
    ]);

    return this.toRecord(fund, movement.get(id), stats._count._all, toRupees(stats._sum.budget));
  }

  /** Income and expenditure heads as they bear on one fund. */
  async breakdown(
    id: number,
    financialYearId?: number,
  ): Promise<{ income: FundBreakdownLineDto[]; expenses: FundBreakdownLineDto[] }> {
    await this.findOneOrFail(id, financialYearId);

    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { fundId: id, ...this.ledger.postedIn(financialYearId) },
      _sum: { debit: true, credit: true },
    });

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: rows.map((row) => row.accountId) } },
      select: { id: true, nameTa: true, nameEn: true, type: true },
    });

    const byId = new Map(accounts.map((account) => [account.id, account]));
    const income: FundBreakdownLineDto[] = [];
    const expenses: FundBreakdownLineDto[] = [];

    for (const row of rows) {
      const account = byId.get(row.accountId);
      if (!account) continue;

      const debit = toRupees(row._sum.debit);
      const credit = toRupees(row._sum.credit);
      const line = {
        accountId: account.id,
        accountName: account.nameEn ?? account.nameTa,
        amount: 0,
        share: 0,
      };

      if (account.type === AccountType.income) income.push({ ...line, amount: credit - debit });
      if (account.type === AccountType.expense) expenses.push({ ...line, amount: debit - credit });
    }

    return { income: this.withShares(income), expenses: this.withShares(expenses) };
  }

  async create(dto: CreateFundDto, context: ActorContext): Promise<FundRecordDto> {
    const fund = await this.prisma.fund.create({
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        openingBalance: dto.openingBalance ?? 0,
      },
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'fund',
      entityRef: String(fund.id),
      summary: `Created fund ${fund.nameTa}`,
    });

    return this.findOneOrFail(fund.id);
  }

  async update(id: number, dto: UpdateFundDto, context: ActorContext): Promise<FundRecordDto> {
    const before = await this.prisma.fund.findUnique({ where: { id } });

    if (!before) throw new NotFoundException(`Fund ${id} was not found`);

    if (dto.openingBalance !== undefined) {
      const entries = await this.prisma.ledgerEntry.count({ where: { fundId: id } });

      if (entries > 0) {
        throw new ConflictException(
          `This fund has ${entries} posted entr${entries === 1 ? 'y' : 'ies'}; its opening balance is settled`,
        );
      }
    }

    if (dto.isActive === false) {
      const open = await this.prisma.project.count({
        where: {
          fundId: id,
          isActive: true,
          status: { in: [ProjectStatus.planning, ProjectStatus.active] },
        },
      });

      if (open > 0) throw new ConflictException(`Close this fund’s ${open} open project(s) first`);
    }

    const fund = await this.prisma.fund.update({
      where: { id },
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        openingBalance: dto.openingBalance,
        isActive: dto.isActive,
      },
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'fund',
      entityRef: String(id),
      summary: `Updated fund ${fund.nameTa}`,
      diff: AuditService.diff(
        { ...before, openingBalance: toRupees(before.openingBalance) },
        { ...fund, openingBalance: toRupees(fund.openingBalance) },
      ),
    });

    return this.findOneOrFail(id);
  }

  async deactivate(id: number, context: ActorContext): Promise<FundRecordDto> {
    return this.update(id, { isActive: false }, context);
  }

  private async movementByFund(financialYearId?: number): Promise<Map<number, Movement>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['fundId', 'accountId'],
      where: this.ledger.postedIn(financialYearId),
      _sum: { debit: true, credit: true },
      _count: { _all: true },
    });

    if (rows.length === 0) return new Map();

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.accountId))] } },
      select: { id: true, type: true },
    });

    const typeOf = new Map(accounts.map((account) => [account.id, account.type]));
    const movement = new Map<number, Movement>();

    for (const row of rows) {
      const current = movement.get(row.fundId) ?? { income: 0, expenses: 0, entryCount: 0 };
      const type = typeOf.get(row.accountId);
      const debit = toRupees(row._sum.debit);
      const credit = toRupees(row._sum.credit);

      if (type === AccountType.income) current.income += credit - debit;
      if (type === AccountType.expense) current.expenses += debit - credit;
      current.entryCount += row._count._all;

      movement.set(row.fundId, current);
    }

    return movement;
  }

  private withShares(lines: FundBreakdownLineDto[]): FundBreakdownLineDto[] {
    const total = lines.reduce((sum, line) => sum + line.amount, 0);

    return lines
      .map((line) => ({ ...line, share: share(line.amount, total) }))
      .sort((a, b) => b.amount - a.amount);
  }

  private toRecord(
    fund: FundRow,
    movement: Movement | undefined,
    projectCount: number,
    committed: number,
  ): FundRecordDto {
    const { income, expenses, entryCount } = movement ?? { income: 0, expenses: 0, entryCount: 0 };
    const opening = toRupees(fund.openingBalance);
    const available = opening + income;

    return {
      ...toFundRef(fund),
      opening,
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      isActive: fund.isActive,
      balance: Math.round((available - expenses) * 100) / 100,
      utilisation: share(expenses, available),
      projectCount,
      committed,
      entryCount,
    };
  }
}
