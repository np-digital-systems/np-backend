import { Injectable } from '@nestjs/common';

import { toRupees } from '../../common/money/money';
import { Prisma } from '../../generated/prisma/client';
import { AccountType, VoucherStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Dimension = 'activityId' | 'partyId' | 'eventId';

export interface Sides {
  debit: number;
  credit: number;
  count: number;
}

const EMPTY: Sides = { debit: 0, credit: 0, count: 0 };

// The single source for derived balances; only Posted vouchers are counted.
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

  // Dimensions are only on coding lines (not the contra), so sums don't net to nil.
  async byActivity(financialYearId?: number): Promise<Map<number, Sides>> {
    return this.byDimension('activityId', financialYearId);
  }

  async byParty(financialYearId?: number): Promise<Map<number, Sides>> {
    return this.byDimension('partyId', financialYearId);
  }

  async byEvent(financialYearId?: number): Promise<Map<number, Sides>> {
    return this.byDimension('eventId', financialYearId);
  }

  // One pass, split by account type (income vs expense).
  async byDimensionAndType(
    dimension: Dimension,
    financialYearId?: number,
  ): Promise<Map<number, Map<AccountType, Sides>>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: [dimension, 'accountId'],
      where: { ...this.postedIn(financialYearId), [dimension]: { not: null } },
      _sum: { debit: true, credit: true },
      _count: { _all: true },
    });

    if (rows.length === 0) return new Map();

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.accountId))] } },
      select: { id: true, type: true },
    });

    const typeOf = new Map(accounts.map((account) => [account.id, account.type]));
    const totals = new Map<number, Map<AccountType, Sides>>();

    for (const row of rows) {
      const key = row[dimension];
      const type = typeOf.get(row.accountId);

      if (key === null || type === undefined) continue;

      const byType = totals.get(key) ?? new Map<AccountType, Sides>();
      const running = byType.get(type) ?? EMPTY;
      const sides = this.toSides(row);

      byType.set(type, {
        debit: running.debit + sides.debit,
        credit: running.credit + sides.credit,
        count: running.count + sides.count,
      });

      totals.set(key, byType);
    }

    return totals;
  }

  private async byDimension(
    dimension: Dimension,
    financialYearId?: number,
  ): Promise<Map<number, Sides>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: [dimension],
      where: { ...this.postedIn(financialYearId), [dimension]: { not: null } },
      _sum: { debit: true, credit: true },
      _count: { _all: true },
    });

    return new Map(
      rows
        .filter(
          (row): row is typeof row & Record<typeof dimension, number> => row[dimension] !== null,
        )
        .map((row) => [row[dimension], this.toSides(row)]),
    );
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
