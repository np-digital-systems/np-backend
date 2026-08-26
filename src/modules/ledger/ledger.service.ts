import { BadRequestException, Injectable } from '@nestjs/common';

import { PageDto, PageMetaDto } from '../../common/dto/page.dto';
import { toRupees, toRupeesOrNull } from '../../common/money/money';
import { Prisma } from '../../generated/prisma/client';
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
        orderBy: [{ date: query.order }, { id: query.order }],
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

  /** The cash book: every posted movement through the configured cash head. */
  async cashBook(query: QueryBookDto): Promise<BookDto> {
    const cashAccountId = await this.settings.cashAccountId();

    return this.book({ accountId: cashAccountId }, query);
  }

  /** The bank book for one account: every posted movement through it. */
  async bankBook(query: QueryBookDto): Promise<BookDto> {
    if (!query.bankAccountId) {
      throw new BadRequestException('bankAccountId is required for the bank book');
    }

    const account = await this.bankAccounts.assertUsable(query.bankAccountId);

    return this.book(
      { bankAccountId: query.bankAccountId },
      query,
      toRupees(account.openingBalance),
    );
  }

  /**
   * A book is a filter over the ledger with a running balance.
   *
   * The opening figure is everything posted before the window, so paging
   * through a date range never loses the balance that came before it.
   */
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
      status: row.voucher.status,
      account: toAccountRef(row.account),
      fund: toFundRef(row.fund),
      project: row.project ? toProjectRef(row.project) : null,
    };
  }
}
