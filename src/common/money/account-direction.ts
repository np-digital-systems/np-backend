import { AccountType } from '../../generated/prisma/enums';

/**
 * Which side increases an account.
 *
 * Assets and expenses grow on the debit side; liabilities, equity and income
 * grow on the credit side. Every balance in this codebase is derived from the
 * ledger through this function, so the chart of accounts cannot disagree with
 * the entries that produced it.
 */
export function isDebitNatured(type: AccountType): boolean {
  return type === AccountType.asset || type === AccountType.expense;
}

export function naturalBalance(
  type: AccountType,
  opening: number,
  debit: number,
  credit: number,
): number {
  const movement = isDebitNatured(type) ? debit - credit : credit - debit;

  return Math.round((opening + movement) * 100) / 100;
}
