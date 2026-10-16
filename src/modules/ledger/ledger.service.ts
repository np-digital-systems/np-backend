import { BadRequestException, Injectable } from '@nestjs/common';

import { PageDto, PageMetaDto } from '../../common/dto/page.dto';
import { toRupees, toRupeesOrNull } from '../../common/money/money';
import { Prisma } from '../../generated/prisma/client';
import { VoucherStatusWire } from '../../common/enums/wire';
import { VoucherStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { toAccountRef } from '../accounts/accounts.service';
import { BankAccountsService } from '../bank-accounts/bank-accounts.service';
import { toFundRef } from '../funds/funds.service';
import { toProjectRef } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import {
  BookDto,
  BookRowDto,
  LedgerRecordDto,
  QueryBookDto,
  QueryLedgerDto,
} from './dto/ledger.dto';

const ENTRY_INCLUDE = {
  account: true,
  fund: true,
  project: true,
  voucher: {
    select: { id: true, ref: true, description: true, mode: true, status: true, chequeNo: true },
  },
} satisfies Prisma.LedgerEntryInclude;

type EntryRow = Prisma.LedgerEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bankAccounts: BankAccountsService,
    private readonly settings: SettingsService,
  ) {}

  async findMany(query: QueryLedgerDto): Promise<PageDto<LedgerRecordDto>> {
    const where = this.whereFor(query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.findMany({
        where,
        include: ENTRY_INCLUDE,
        // Only voucher order follows query.order; within a voucher, lineNo keeps debit before credit.
        orderBy: [{ date: query.order }, { voucherId: query.order }, { lineNo: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);

    return new PageDto(
      rows.map((row) => this.toRecord(row)),
      new PageMetaDto(query.page, query.limit, total),
    );
  }

  async cashBook(query: QueryBookDto): Promise<BookDto> {
    const cashAccountId = await this.settings.cashAccountId();

    return this.book({ accountId: cashAccountId }, query, await this.openingOf(cashAccountId));
  }

  async bankBook(query: QueryBookDto): Promise<BookDto> {
    if (!query.bankAccountId) {
      throw new BadRequestException('bankAccountId is required for the bank book');
    }

    const account = await this.bankAccounts.assertUsable(query.bankAccountId);

    return this.book(
      { bankAccountId: query.bankAccountId },
      query,
      await this.openingOf(account.ledgerAccountId),
    );
  }

  // Opening balances live only on the ledger head, so every report agrees.
  private async openingOf(accountId: number): Promise<number> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { openingBalance: true },
    });

    return toRupees(account?.openingBalance);
  }

  // Opening figure is everything posted before the window, so date ranges keep the running balance.
  private async book(
    scope: Prisma.LedgerEntryWhereInput,
    query: QueryBookDto,
    openingBalance = 0,
  ): Promise<BookDto> {
    const posted: Prisma.LedgerEntryWhereInput = {
      ...scope,
      voucher: { status: VoucherStatus.Posted, financialYearId: query.financialYearId },
    };

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    const [before, rows] = await Promise.all([
      from
        ? this.prisma.ledgerEntry.aggregate({
            where: { ...posted, date: { lt: from } },
            _sum: { debit: true, credit: true },
          })
        : Promise.resolve(null),
      this.prisma.ledgerEntry.findMany({
        where: { ...posted, date: { gte: from, lte: to } },
        include: ENTRY_INCLUDE,
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const opening =
      openingBalance + (before ? toRupees(before._sum.debit) - toRupees(before._sum.credit) : 0);

    let balance = opening;
    let inflow = 0;
    let outflow = 0;

    const bookRows: BookRowDto[] = rows.map((row) => {
      const debit = toRupees(row.debit);
      const credit = toRupees(row.credit);

      balance = Math.round((balance + debit - credit) * 100) / 100;
      inflow += debit;
      outflow += credit;

      return {
        ...this.toRecord(row),
        inflow: debit,
        outflow: credit,
        balance,
        chequeNo: row.voucher.chequeNo,
      };
    });

    const round = (value: number) => Math.round(value * 100) / 100;

    return {
      rows: bookRows,
      summary: {
        opening: round(opening),
        inflow: round(inflow),
        outflow: round(outflow),
        closing: round(balance),
      },
    };
  }

  private whereFor(query: QueryLedgerDto): Prisma.LedgerEntryWhereInput {
    return {
      accountId: query.accountId,
      fundId: query.fundId,
      projectId: query.projectId,
      date:
        query.from || query.to
          ? {
              gte: query.from ? new Date(query.from) : undefined,
              lte: query.to ? new Date(query.to) : undefined,
            }
          : undefined,
      voucher: {
        status: VoucherStatus.Posted,
        financialYearId: query.financialYearId,
        ...(query.search
          ? {
              OR: [
                { ref: { contains: query.search, mode: 'insensitive' } },
                { description: { contains: query.search, mode: 'insensitive' } },
                { party: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    };
  }

  private toRecord(row: EntryRow): LedgerRecordDto {
    return {
      id: Number(row.id),
      voucherId: Number(row.voucherId),
      date: row.date.toISOString().slice(0, 10),
      ref: row.voucher.ref,
      description: row.voucher.description,
      accountId: row.accountId,
      fundId: row.fundId,
      projectId: row.projectId,
      debit: toRupeesOrNull(row.debit),
      credit: toRupeesOrNull(row.credit),
      mode: row.voucher.mode,
      bankAccountId: row.bankAccountId,
      status: VoucherStatusWire.toWire(row.voucher.status),
      account: toAccountRef(row.account),
      fund: toFundRef(row.fund),
      project: row.project ? toProjectRef(row.project) : null,
    };
  }
}
