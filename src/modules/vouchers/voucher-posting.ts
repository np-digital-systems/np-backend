import { PaymentMode, VoucherKind } from '../../generated/prisma/enums';

export interface PostingLine {
  lineNo: number;
  accountId: number;
  debit: number | null;
  credit: number | null;
  bankAccountId: number | null;
}

export interface PostingInput {
  kind: VoucherKind;
  amount: number;
  /** The income or expense head named on the voucher. */
  accountId: number;
  /** The cash or bank head the money actually moved through. */
  contraAccountId: number;
  bankAccountId: number | null;
}

/**
 * The two legs of a voucher.
 *
 * A voucher names one head and one amount; the contra side is implied by the
 * payment mode. Money coming in debits where it landed and credits the income
 * head that explains it; money going out debits the expense head and credits
 * where it came from.
 *
 * Only the contra leg carries `bankAccountId`, which is what lets the bank book
 * be a filter over the ledger rather than a parallel list that can drift.
 */
export function buildPostingLines(input: PostingInput): PostingLine[] {
  const { amount, accountId, contraAccountId, bankAccountId } = input;
  const isReceipt = input.kind === VoucherKind.receipt;

  return [
    {
      lineNo: 1,
      accountId: isReceipt ? contraAccountId : accountId,
      debit: amount,
      credit: null,
      bankAccountId: isReceipt ? bankAccountId : null,
    },
    {
      lineNo: 2,
      accountId: isReceipt ? accountId : contraAccountId,
      debit: null,
      credit: amount,
      bankAccountId: isReceipt ? null : bankAccountId,
    },
  ];
}

export function movesThroughBank(mode: PaymentMode): boolean {
  return mode !== PaymentMode.cash;
}
