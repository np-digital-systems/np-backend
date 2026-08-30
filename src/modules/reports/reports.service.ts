import { Injectable } from '@nestjs/common';

import { isDebitNatured } from '../../common/money/account-direction';
import { share, toRupees } from '../../common/money/money';
import { AccountType, DepositStatus, VoucherStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { toAccountRef } from '../accounts/accounts.service';
import { assetMaths } from '../assets/asset-maths';
import { depositMaths } from '../fixed-deposits/deposit-maths';
import { FundsService } from '../funds/funds.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import { SettingsService } from '../settings/settings.service';
import {
  AccountingSummaryDto,
  FinanceSummaryDto,
  IncomeStatementDto,
  StatementLineDto,
  TrialBalanceDto,
} from './dto/report.dto';

const round = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerQueryService,
    private readonly funds: FundsService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The trial balance.
   *
   * Every account's net position on its natural side. Because it is summed from
   * the same double entries the books are made of, the two totals agree unless
   * something has gone badly wrong — which is precisely what it is for.
   */
  async trialBalance(financialYearId?: number): Promise<TrialBalanceDto> {
    const yearId = await this.resolveYear(financialYearId);
    const sides = await this.ledger.byAccount(yearId);

    /*
     * A head belongs here if it moved during the year or if it started the year
     * somewhere. Listing only what moved would let the two totals agree on
     * movement alone while every balance on the report was wrong, and would
     * hide an opening position that does not itself balance — which is the one
     * error a trial balance exists to catch.
     */
    const accounts = await this.prisma.account.findMany({
      where: {
        OR: [{ id: { in: [...sides.keys()] } }, { openingBalance: { not: 0 } }],
      },
      orderBy: { code: 'asc' },
    });

    let totalDebit = 0;
    let totalCredit = 0;

    const rows = accounts.map((account) => {
      const totals = sides.get(account.id) ?? LedgerQueryService.empty();

      // An opening is held on the head's own natural side, while the columns
      // below are debit-positive, so a credit-natured opening enters negative.
      const opening = toRupees(account.openingBalance);
      const signedOpening = isDebitNatured(account.type) ? opening : -opening;

      const net = signedOpening + totals.debit - totals.credit;
      const debit = net > 0 ? net : 0;
      const credit = net < 0 ? -net : 0;

      totalDebit += debit;
      totalCredit += credit;

      return { account: toAccountRef(account), debit: round(debit), credit: round(credit) };
    });

    return {
      rows,
      totalDebit: round(totalDebit),
      totalCredit: round(totalCredit),
      balanced: Math.abs(totalDebit - totalCredit) < 0.005,
    };
  }

  async incomeStatement(financialYearId?: number): Promise<IncomeStatementDto> {
    const yearId = await this.resolveYear(financialYearId);
    const sides = await this.ledger.byAccount(yearId);

    const accounts = await this.prisma.account.findMany({
      where: {
        id: { in: [...sides.keys()] },
        type: { in: [AccountType.income, AccountType.expense] },
      },
      orderBy: { code: 'asc' },
    });

    const income: StatementLineDto[] = [];
    const expenses: StatementLineDto[] = [];

    for (const account of accounts) {
      const totals = sides.get(account.id) ?? LedgerQueryService.empty();
      const amount = isDebitNatured(account.type)
        ? totals.debit - totals.credit
        : totals.credit - totals.debit;

      if (amount === 0) continue;

      const line = { account: toAccountRef(account), amount: round(amount), share: 0 };

      (account.type === AccountType.income ? income : expenses).push(line);
    }

    const totalIncome = income.reduce((sum, line) => sum + line.amount, 0);
    const totalExpenses = expenses.reduce((sum, line) => sum + line.amount, 0);

    const withShares = (lines: StatementLineDto[], total: number) =>
      lines
        .map((line) => ({ ...line, share: share(line.amount, total) }))
        .sort((a, b) => b.amount - a.amount);

    return {
      income: withShares(income, totalIncome),
      expenses: withShares(expenses, totalExpenses),
      totalIncome: round(totalIncome),
      totalExpenses: round(totalExpenses),
      surplus: round(totalIncome - totalExpenses),
    };
  }

  async accountingSummary(financialYearId?: number): Promise<AccountingSummaryDto> {
    const yearId = await this.resolveYear(financialYearId);

    const [statement, sides, pending, bankAccounts, cashAccountId] = await Promise.all([
      this.incomeStatement(yearId),
      this.ledger.byAccount(yearId),
      this.prisma.voucher.aggregate({
        where: { financialYearId: yearId, status: VoucherStatus.PendingApproval },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.bankAccount.findMany({ select: { ledgerAccountId: true } }),
      this.settings.accounting().then((settings) => settings.cashAccountId),
    ]);

    // Opening positions come from the ledger heads, the same place the chart of
    // accounts and the books read them, so no two screens can disagree.
    const heads = await this.prisma.account.findMany({
      where: {
        id: {
          in: [
            ...bankAccounts.map((account) => account.ledgerAccountId),
            ...(cashAccountId === null ? [] : [cashAccountId]),
          ],
        },
      },
      select: { id: true, openingBalance: true },
    });

    const openingOf = new Map(heads.map((head) => [head.id, toRupees(head.openingBalance)]));

    const balanceOf = (accountId: number) => {
      const totals = sides.get(accountId) ?? LedgerQueryService.empty();

      return (openingOf.get(accountId) ?? 0) + totals.debit - totals.credit;
    };

    const bankBalance = bankAccounts.reduce(
      (sum, account) => sum + balanceOf(account.ledgerAccountId),
      0,
    );

    return {
      income: statement.totalIncome,
      expenses: statement.totalExpenses,
      surplus: statement.surplus,
      cashBalance: cashAccountId === null ? 0 : round(balanceOf(cashAccountId)),
      bankBalance: round(bankBalance),
      pendingApprovals: pending._count._all,
      pendingAmount: toRupees(pending._sum.amount),
    };
  }

  async financeSummary(financialYearId?: number): Promise<FinanceSummaryDto> {
    const yearId = await this.resolveYear(financialYearId);

    const [funds, deposits, assets] = await Promise.all([
      this.funds.findMany({ isActive: true, financialYearId: yearId }),
      this.prisma.fixedDeposit.findMany({ where: { status: DepositStatus.active } }),
      this.prisma.asset.findMany({ where: { status: { not: 'disposed' } } }),
    ]);

    const depositTotals = deposits.reduce(
      (totals, deposit) => {
        const principal = toRupees(deposit.principal);
        const { maturityValue } = depositMaths(
          principal,
          toRupees(deposit.interestRate),
          deposit.placedOn,
          deposit.maturesOn,
        );

        return {
          principal: totals.principal + principal,
          maturityValue: totals.maturityValue + maturityValue,
        };
      },
      { principal: 0, maturityValue: 0 },
    );

    const assetTotals = assets.reduce(
      (totals, asset) => {
        const cost = toRupees(asset.cost);
        const { netBookValue } = assetMaths(
          cost,
          toRupees(asset.depreciationRate),
          asset.acquiredOn,
          asset.disposedOn,
        );

        return { cost: totals.cost + cost, netBookValue: totals.netBookValue + netBookValue };
      },
      { cost: 0, netBookValue: 0 },
    );

    return {
      fundBalance: round(funds.reduce((sum, fund) => sum + fund.balance, 0)),
      depositPrincipal: round(depositTotals.principal),
      depositMaturityValue: round(depositTotals.maturityValue),
      assetCost: round(assetTotals.cost),
      assetNetBookValue: round(assetTotals.netBookValue),
    };
  }

  private async resolveYear(financialYearId?: number): Promise<number | undefined> {
    if (financialYearId) return financialYearId;

    const current = await this.prisma.financialYear.findFirst({
      where: { isCurrent: true },
      select: { id: true },
    });

    return current?.id;
  }
}
