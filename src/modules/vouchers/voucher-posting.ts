import { EntrySide, PaymentMode, VoucherKind } from '../../generated/prisma/enums';

export interface PostingLine {
  lineNo: number;
  accountId: number;
  debit: number | null;
  credit: number | null;
  fundId: number;
  projectId: number | null;
  activityId: number | null;
  eventId: number | null;
  fixedDepositId: number | null;
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
  fixedDepositId: number | null;
  /** Journal lines only. */
  side: EntrySide | null;
  /** Set on a contra's destination when it is a bank account. */
  bankAccountId: number | null;
}

export interface PostingInput {
  kind: VoucherKind;
  lines: readonly CodingLine[];
  /** The cash or bank head the money actually moved through; null for a journal. */
  contraAccountId: number | null;
  bankAccountId: number | null;
}

const round = (value: number) => Math.round(value * 100) / 100;

// Receipts debit cash/bank and credit the heads; payments and contras the reverse, a contra's "head"
// being the cash or bank account the money went to. A journal posts its lines as written, with no
// cash or bank side. The contra is split per fund so restricted-fund cash stays identifiable.
// Activity/event/party go on coding lines only (they'd net to nil on both sides), and only cash/bank
// lines carry bankAccountId, so the bank book is a ledger filter.
export function buildPostingLines(input: PostingInput): PostingLine[] {
  if (input.kind === VoucherKind.journal) return journalLines(input.lines);

  const { lines, contraAccountId, bankAccountId } = input;
  const isReceipt = input.kind === VoucherKind.receipt;

  if (contraAccountId === null) {
    throw new Error(`A ${input.kind} posts through a cash or bank head`);
  }

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
    fixedDepositId: null,
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
    fixedDepositId: line.fixedDepositId,
    bankAccountId: line.bankAccountId,
    isCoding: true,
  }));

  // Receipts list the contra first, payments the heads first, matching the printed voucher.
  const ordered = isReceipt ? [...contra, ...coding] : [...coding, ...contra];

  return ordered.map((line, index) => ({ ...line, lineNo: index + 1 }));
}

// Debits first, then credits, the way a journal is written up.
function journalLines(lines: readonly CodingLine[]): PostingLine[] {
  const posted = lines.map((line) => ({
    lineNo: 0,
    accountId: line.accountId,
    debit: line.side === EntrySide.debit ? round(line.amount) : null,
    credit: line.side === EntrySide.credit ? round(line.amount) : null,
    fundId: line.fundId,
    projectId: line.projectId,
    activityId: line.activityId,
    eventId: line.eventId,
    fixedDepositId: line.fixedDepositId,
    bankAccountId: null,
    isCoding: true,
  }));

  return [
    ...posted.filter((line) => line.debit !== null),
    ...posted.filter((line) => line.credit !== null),
  ].map((line, index) => ({ ...line, lineNo: index + 1 }));
}

export function movesThroughBank(mode: PaymentMode): boolean {
  return mode !== PaymentMode.cash;
}

export function sumLines(lines: readonly { amount: number }[]): number {
  return round(lines.reduce((total, line) => total + line.amount, 0));
}

// A journal's total is one side of it; every other voucher's is the sum of its heads.
export function voucherTotal(
  kind: VoucherKind,
  lines: readonly { amount: number; side?: EntrySide | null }[],
): number {
  return kind === VoucherKind.journal
    ? sumLines(lines.filter((line) => line.side === EntrySide.debit))
    : sumLines(lines);
}

export function journalIsBalanced(
  lines: readonly { amount: number; side?: EntrySide | null }[],
): boolean {
  const debit = sumLines(lines.filter((line) => line.side === EntrySide.debit));
  const credit = sumLines(lines.filter((line) => line.side === EntrySide.credit));

  return debit > 0 && debit === credit;
}
