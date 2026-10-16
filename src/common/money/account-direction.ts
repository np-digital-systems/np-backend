import { AccountType } from '../../generated/prisma/enums';

// Assets and expenses increase on the debit side; liabilities, equity and income on the credit side.
// Every balance is derived through this.
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
