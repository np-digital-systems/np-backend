import { Injectable } from '@nestjs/common';

import { toRupees } from '../../common/money/money';
import { Prisma } from '../../generated/prisma/client';
import { VoucherStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface Sides {
  debit: number;
  credit: number;
  count: number;
}

const EMPTY: Sides = { debit: 0, credit: 0, count: 0 };

/**
 * Aggregation over posted ledger entries.
 *
 * Every derived balance in the accounting modules comes through here, so there
 * is exactly one definition of "what the ledger says" and it always excludes
 * vouchers that have not reached `Posted`.
 */
@Injectable()
export class LedgerQueryService {
  constructor(private readonly prisma: PrismaService) {}

  postedIn(financialYearId?: number): Prisma.LedgerEntryWhereInput {
    return { voucher: { status: VoucherStatus.Posted, financialYearId } };
  }

  async byAccount(financialYearId?: number): Promise<Map<number, Sides>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['accountId'],
      where: this.postedIn(financialYearId),
      _sum: { debit: true, credit: true },
      _count: { _all: true },
    });

    return new Map(rows.map((row) => [row.accountId, this.toSides(row)]));
  }

  async byFund(financialYearId?: number): Promise<Map<number, Sides>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['fundId'],
      where: this.postedIn(financialYearId),
      _sum: { debit: true, credit: true },
      _count: { _all: true },
    });

    return new Map(rows.map((row) => [row.fundId, this.toSides(row)]));
  }

  async byProject(financialYearId?: number): Promise<Map<number, Sides>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['projectId'],
      where: { ...this.postedIn(financialYearId), projectId: { not: null } },
      _sum: { debit: true, credit: true },
      _count: { _all: true },
    });

    return new Map(
      rows
        .filter((row) => row.projectId !== null)
        .map((row) => [row.projectId!, this.toSides(row)]),
    );
  }

  async forAccount(accountId: number, financialYearId?: number): Promise<Sides> {
    return (await this.byAccount(financialYearId)).get(accountId) ?? EMPTY;
  }

  static empty(): Sides {
    return EMPTY;
  }

  private toSides(row: {
    _sum: { debit: Prisma.Decimal | null; credit: Prisma.Decimal | null };
    _count: { _all: number };
  }): Sides {
    return {
      debit: toRupees(row._sum.debit),
      credit: toRupees(row._sum.credit),
      count: row._count._all,
    };
  }
}
