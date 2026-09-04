import { PaymentMode, VoucherKind } from '../../generated/prisma/enums';

export interface PostingLine {
  lineNo: number;
  accountId: number;
  debit: number | null;
  credit: number | null;
  fundId: number;
  projectId: number | null;
  activityId: number | null;
  bankAccountId: number | null;
  /** A coding line, as opposed to the cash or bank contra it is balanced by. */
  isCoding: boolean;
}

/** One head a voucher is coded to, as the ledger needs it. */
export interface CodingLine {
  accountId: number;
  amount: number;
  fundId: number;
  projectId: number | null;
  activityId: number | null;
}

export interface PostingInput {
  kind: VoucherKind;
  lines: readonly CodingLine[];
  /** The cash or bank head the money actually moved through. */
  contraAccountId: number;
  bankAccountId: number | null;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The ledger entries a voucher becomes.
 *
 * A voucher names one or more heads; the contra side is implied by the payment
 * mode. Money coming in debits where it landed and credits the heads that
 * explain it; money going out debits those heads and credits where it came
 * from.
 *
 * The contra is split by fund rather than written as one lump. A receipt of
 * Rs 5,000 with Rs 2,000 earmarked for annadhanam puts Rs 3,000 of cash in the
 * general fund and Rs 2,000 in the annadhanam fund — one combined line would
 * still balance the voucher while leaving the books unable to say how much
 * cash belongs to a restricted fund, which is the whole reason it is restricted.
 *
 * Analytical dimensions ride only on the coding lines. Carried on the contra as
 * well, an activity would appear on both sides of every entry and net to nil.
 *
 * Only the contra carries `bankAccountId`, which is what lets the bank book be
 * a filter over the ledger rather than a parallel list that can drift.
 */
export function buildPostingLines(input: PostingInput): PostingLine[] {
  const { lines, contraAccountId, bankAccountId } = input;
  const isReceipt = input.kind === VoucherKind.receipt;

  // Funds keep the order they were first coded in, so a voucher's ledger reads
  // in the order the clerk entered it rather than by whatever id sorts first.
  const byFund = new Map<number, number>();

  for (const line of lines) {
    byFund.set(line.fundId, round((byFund.get(line.fundId) ?? 0) + line.amount));
  }

  const contra: PostingLine[] = [...byFund.entries()].map(([fundId, amount]) => ({
    lineNo: 0,
    accountId: contraAccountId,
    debit: isReceipt ? amount : null,
    credit: isReceipt ? null : amount,
    fundId,
    projectId: null,
    activityId: null,
    bankAccountId,
    isCoding: false,
  }));

  const coding: PostingLine[] = lines.map((line) => ({
    lineNo: 0,
    accountId: line.accountId,
    debit: isReceipt ? null : round(line.amount),
    credit: isReceipt ? round(line.amount) : null,
    fundId: line.fundId,
    projectId: line.projectId,
    activityId: line.activityId,
    bankAccountId: null,
    isCoding: true,
  }));

  // Money first for a receipt, the reason first for a payment — the order each
  // is read aloud in, and the order the printed voucher shows.
  const ordered = isReceipt ? [...contra, ...coding] : [...coding, ...contra];

  return ordered.map((line, index) => ({ ...line, lineNo: index + 1 }));
}

export function movesThroughBank(mode: PaymentMode): boolean {
  return mode !== PaymentMode.cash;
}

/** What the voucher header records as its total. */
export function sumLines(lines: readonly { amount: number }[]): number {
  return round(lines.reduce((total, line) => total + line.amount, 0));
}
