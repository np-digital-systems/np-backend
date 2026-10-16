import { PaymentMode, VoucherKind } from '../../generated/prisma/enums';

export interface PostingLine {
  lineNo: number;
  accountId: number;
  debit: number | null;
  credit: number | null;
  fundId: number;
  projectId: number | null;
  activityId: number | null;
  eventId: number | null;
  bankAccountId: number | null;
  /** False for the cash/bank contra line. */
  isCoding: boolean;
}

interface CodingLine {
  accountId: number;
  amount: number;
  fundId: number;
  projectId: number | null;
  activityId: number | null;
  eventId: number | null;
}

export interface PostingInput {
  kind: VoucherKind;
  lines: readonly CodingLine[];
  /** The cash or bank head the money actually moved through. */
  contraAccountId: number;
  bankAccountId: number | null;
}

const round = (value: number) => Math.round(value * 100) / 100;

// Receipts debit cash/bank and credit the heads; payments the reverse. The contra is split per fund
// so restricted-fund cash stays identifiable. Activity/event/party go on coding lines only (they'd net
// to nil on both sides); only the contra carries bankAccountId, so the bank book is a ledger filter.
export function buildPostingLines(input: PostingInput): PostingLine[] {
  const { lines, contraAccountId, bankAccountId } = input;
  const isReceipt = input.kind === VoucherKind.receipt;

  // Keep funds in entry order so the ledger reads as the clerk entered it.
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
    eventId: null,
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
    eventId: line.eventId,
    bankAccountId: null,
    isCoding: true,
  }));

  // Receipts list the contra first, payments the heads first, matching the printed voucher.
  const ordered = isReceipt ? [...contra, ...coding] : [...coding, ...contra];

  return ordered.map((line, index) => ({ ...line, lineNo: index + 1 }));
}

export function movesThroughBank(mode: PaymentMode): boolean {
  return mode !== PaymentMode.cash;
}

export function sumLines(lines: readonly { amount: number }[]): number {
  return round(lines.reduce((total, line) => total + line.amount, 0));
}
