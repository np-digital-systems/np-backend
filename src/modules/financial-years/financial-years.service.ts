import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { toRupees, toRupeesOrNull } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AccountType, FinancialYearStatus, VoucherStatus } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  CreateFinancialYearDto,
  FinancialYearDto,
  QueryFinancialYearsDto,
} from './dto/financial-year.dto';

type YearRow = Prisma.FinancialYearGetPayload<Record<string, never>>;

const round = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class FinancialYearsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async findMany(query: QueryFinancialYearsDto): Promise<FinancialYearDto[]> {
    const years = await this.prisma.financialYear.findMany({
      where: { status: query.status },
      orderBy: { startsOn: 'desc' },
    });

    return Promise.all(years.map((year) => this.toDto(year)));
  }

  async findOneOrFail(id: number): Promise<FinancialYearDto> {
    const year = await this.prisma.financialYear.findUnique({ where: { id } });

    if (!year) throw new NotFoundException(`Financial year ${id} was not found`);

    return this.toDto(year);
  }

  async current(): Promise<FinancialYearDto> {
    const year = await this.prisma.financialYear.findFirst({ where: { isCurrent: true } });

    if (!year) throw new NotFoundException('No financial year is marked current');

    return this.toDto(year);
  }

  /** The year a voucher dated `date` belongs to. Refuses a closed year. */
  async resolveOpenYear(date: Date): Promise<YearRow> {
    const year = await this.prisma.financialYear.findFirst({
      where: { startsOn: { lte: date }, endsOn: { gte: date } },
    });

    if (!year) {
      throw new BadRequestException(
        `${date.toISOString().slice(0, 10)} does not fall in any financial year`,
      );
    }

    if (year.status === FinancialYearStatus.closed) {
      throw new ConflictException(`Financial year ${year.label} is closed`);
    }

    return year;
  }

  async create(dto: CreateFinancialYearDto, context: ActorContext): Promise<FinancialYearDto> {
    const startsOn = new Date(dto.startsOn);
    const endsOn = new Date(dto.endsOn);

    if (endsOn <= startsOn) {
      throw new BadRequestException('The year must end after it starts');
    }

    const year = await this.prisma.financialYear.create({
      data: {
        label: dto.label,
        startsOn,
        endsOn,
        // Not taken from the request: the opening position is read from the
        // chart of accounts while the year runs, and frozen here on close.
        status: FinancialYearStatus.upcoming,
      },
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'financial_year',
      entityRef: String(year.id),
      summary: `Created financial year ${year.label}`,
    });

    return this.toDto(year);
  }

  async open(id: number, context: ActorContext): Promise<FinancialYearDto> {
    const year = await this.prisma.financialYear.findUnique({ where: { id } });

    if (!year) throw new NotFoundException(`Financial year ${id} was not found`);
    if (year.status === FinancialYearStatus.closed) {
      throw new ConflictException('A closed year cannot be reopened');
    }

    const opened = await this.prisma.$transaction(async (tx) => {
      await tx.financialYear.updateMany({
        where: { isCurrent: true },
        data: { isCurrent: false },
      });

      return tx.financialYear.update({
        where: { id },
        data: { status: FinancialYearStatus.open, isCurrent: true },
      });
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'financial_year',
      entityRef: String(id),
      summary: `Opened ${opened.label} and made it the current year`,
    });

    return this.toDto(opened);
  }

  /**
   * Close a year by freezing its totals into the row.
   *
   * The figures become a snapshot rather than a live aggregate, so a later
   * correction cannot silently rewrite a statement that has been published.
   */
  async close(id: number, context: ActorContext): Promise<FinancialYearDto> {
    const year = await this.prisma.financialYear.findUnique({ where: { id } });

    if (!year) throw new NotFoundException(`Financial year ${id} was not found`);
    if (year.status === FinancialYearStatus.closed) {
      throw new ConflictException(`${year.label} is already closed`);
    }

    const unfinished = await this.prisma.voucher.count({
      where: {
        financialYearId: id,
        status: {
          in: [VoucherStatus.Draft, VoucherStatus.PendingApproval, VoucherStatus.Approved],
        },
      },
    });

    if (unfinished > 0) {
      throw new ConflictException(
        `${unfinished} voucher(s) are still unposted; post or cancel them before closing ${year.label}`,
      );
    }

    const [totals, openingBalance] = await Promise.all([
      this.liveTotals(year),
      this.openingPosition(),
    ]);

    const closed = await this.prisma.financialYear.update({
      where: { id },
      data: {
        status: FinancialYearStatus.closed,
        isCurrent: false,
        openingBalance,
        income: totals.income,
        expenses: totals.expenses,
        voucherCount: totals.voucherCount,
        closedOn: new Date(),
        closedBy: context.actor.id,
      },
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'financial_year',
      entityRef: String(id),
      summary: `Closed ${year.label}: income ${totals.income}, expenses ${totals.expenses}, ${totals.voucherCount} vouchers`,
      diff: { income: totals.income, expenses: totals.expenses, voucherCount: totals.voucherCount },
    });

    return this.toDto(closed);
  }

  /**
   * The money the year starts with: the opening on the cash head plus the
   * opening on every bank account's ledger head.
   *
   * Derived rather than typed in when the year is created, because a figure
   * entered by hand can drift from the chart of accounts the books are read
   * from — and then two screens disagree about the same money. The heads are
   * gathered exactly as the dashboard gathers them, so the year's opening and
   * the cash and bank tiles cannot tell different stories.
   */
  private async openingPosition(): Promise<number> {
    const [bankAccounts, { cashAccountId }] = await Promise.all([
      this.prisma.bankAccount.findMany({ select: { ledgerAccountId: true } }),
      this.settings.accounting(),
    ]);

    const ids = [
      ...bankAccounts.map((account) => account.ledgerAccountId),
      ...(cashAccountId === null ? [] : [cashAccountId]),
    ];

    if (ids.length === 0) return 0;

    const heads = await this.prisma.account.findMany({
      where: { id: { in: ids } },
      select: { openingBalance: true },
    });

    return round(heads.reduce((sum, head) => sum + toRupees(head.openingBalance), 0));
  }

  private async liveTotals(
    year: YearRow,
  ): Promise<{ income: number; expenses: number; voucherCount: number }> {
    const [sides, voucherCount] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({
        by: ['accountId'],
        where: { voucher: { financialYearId: year.id, status: VoucherStatus.Posted } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.voucher.count({
        where: { financialYearId: year.id, status: VoucherStatus.Posted },
      }),
    ]);

    if (sides.length === 0) return { income: 0, expenses: 0, voucherCount };

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: sides.map((row) => row.accountId) } },
      select: { id: true, type: true },
    });

    const typeOf = new Map(accounts.map((account) => [account.id, account.type]));

    let income = 0;
    let expenses = 0;

    for (const row of sides) {
      const type = typeOf.get(row.accountId);
      const debit = toRupees(row._sum.debit);
      const credit = toRupees(row._sum.credit);

      if (type === AccountType.income) income += credit - debit;
      if (type === AccountType.expense) expenses += debit - credit;
    }

    return {
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      voucherCount,
    };
  }

  private async toDto(year: YearRow): Promise<FinancialYearDto> {
    const frozen = year.status === FinancialYearStatus.closed;
    const totals = frozen
      ? {
          income: toRupeesOrNull(year.income),
          expenses: toRupeesOrNull(year.expenses),
          voucherCount: year.voucherCount,
        }
      : await this.liveTotals(year);

    // The opening follows the same rule as the totals beside it: a live read
    // of the chart of accounts while the year runs, the snapshot once closed.
    const openingBalance = frozen ? toRupees(year.openingBalance) : await this.openingPosition();

    const surplus =
      totals.income === null || totals.expenses === null
        ? null
        : Math.round((totals.income - totals.expenses) * 100) / 100;

    return {
      id: year.id,
      label: year.label,
      startsOn: year.startsOn.toISOString().slice(0, 10),
      endsOn: year.endsOn.toISOString().slice(0, 10),
      status: year.status,
      isCurrent: year.isCurrent,
      openingBalance,
      income: totals.income,
      expenses: totals.expenses,
      surplus,
      voucherCount: totals.voucherCount,
      closedOn: year.closedOn,
    };
  }
}
