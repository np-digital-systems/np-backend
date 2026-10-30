import { EntrySide, VoucherKind } from '../../generated/prisma/enums';
import { buildPostingLines, journalIsBalanced, voucherTotal } from './voucher-posting';

const CASH = 1001;
const BANK_HEAD = 1200;
const BANK = 7;
const INCOME = 4001;
const EXPENSE = 5001;
const DEPOSITS = 1801;
const ENDOWMENT = 3001;

const line = (
  accountId: number,
  amount: number,
  overrides: Partial<Parameters<typeof buildPostingLines>[0]['lines'][number]> = {},
) => ({
  accountId,
  amount,
  fundId: 1,
  projectId: null,
  activityId: null,
  eventId: null,
  fixedDepositId: null,
  side: null,
  bankAccountId: null,
  ...overrides,
});

const sides = (posted: ReturnType<typeof buildPostingLines>) =>
  posted.map(({ accountId, debit, credit, bankAccountId }) => ({
    accountId,
    debit,
    credit,
    bankAccountId,
  }));

describe('buildPostingLines', () => {
  it('debits the bank and credits the head on a receipt', () => {
    const posted = buildPostingLines({
      kind: VoucherKind.receipt,
      lines: [line(INCOME, 9_000)],
      contraAccountId: BANK_HEAD,
      bankAccountId: BANK,
    });

    expect(sides(posted)).toEqual([
      { accountId: BANK_HEAD, debit: 9_000, credit: null, bankAccountId: BANK },
      { accountId: INCOME, debit: null, credit: 9_000, bankAccountId: null },
    ]);
  });

  it('debits an asset head and credits the bank when a deposit is placed by payment', () => {
    const posted = buildPostingLines({
      kind: VoucherKind.payment,
      lines: [line(DEPOSITS, 100_000, { fixedDepositId: 3 })],
      contraAccountId: BANK_HEAD,
      bankAccountId: BANK,
    });

    expect(sides(posted)).toEqual([
      { accountId: DEPOSITS, debit: 100_000, credit: null, bankAccountId: null },
      { accountId: BANK_HEAD, debit: null, credit: 100_000, bankAccountId: BANK },
    ]);
    expect(posted[0].fixedDepositId).toBe(3);
  });

  it('moves money from cash to a bank on a contra, tagging the bank side for the bank book', () => {
    const posted = buildPostingLines({
      kind: VoucherKind.contra,
      lines: [line(BANK_HEAD, 50_000, { bankAccountId: BANK })],
      contraAccountId: CASH,
      bankAccountId: null,
    });

    expect(sides(posted)).toEqual([
      { accountId: BANK_HEAD, debit: 50_000, credit: null, bankAccountId: BANK },
      { accountId: CASH, debit: null, credit: 50_000, bankAccountId: null },
    ]);
  });

  it('moves money from a bank to cash on a contra', () => {
    const posted = buildPostingLines({
      kind: VoucherKind.contra,
      lines: [line(CASH, 9_000)],
      contraAccountId: BANK_HEAD,
      bankAccountId: BANK,
    });

    expect(sides(posted)).toEqual([
      { accountId: CASH, debit: 9_000, credit: null, bankAccountId: null },
      { accountId: BANK_HEAD, debit: null, credit: 9_000, bankAccountId: BANK },
    ]);
  });

  it('posts a journal as written, debits first, with no cash or bank side', () => {
    const posted = buildPostingLines({
      kind: VoucherKind.journal,
      lines: [
        line(ENDOWMENT, 100_000, { side: EntrySide.credit }),
        line(DEPOSITS, 100_000, { side: EntrySide.debit, fixedDepositId: 3 }),
      ],
      contraAccountId: null,
      bankAccountId: null,
    });

    expect(sides(posted)).toEqual([
      { accountId: DEPOSITS, debit: 100_000, credit: null, bankAccountId: null },
      { accountId: ENDOWMENT, debit: null, credit: 100_000, bankAccountId: null },
    ]);
    expect(posted.map((entry) => entry.lineNo)).toEqual([1, 2]);
  });

  it('splits the cash side per fund so restricted money stays identifiable', () => {
    const posted = buildPostingLines({
      kind: VoucherKind.payment,
      lines: [line(EXPENSE, 300, { fundId: 1 }), line(EXPENSE, 200, { fundId: 2 })],
      contraAccountId: CASH,
      bankAccountId: null,
    });

    expect(posted.filter((entry) => entry.accountId === CASH).map((entry) => entry.credit)).toEqual(
      [300, 200],
    );
  });

  it('refuses to post money through no cash or bank head', () => {
    expect(() =>
      buildPostingLines({
        kind: VoucherKind.receipt,
        lines: [line(INCOME, 10)],
        contraAccountId: null,
        bankAccountId: null,
      }),
    ).toThrow();
  });
});

describe('voucherTotal and journalIsBalanced', () => {
  const journal = [
    { amount: 109_000, side: EntrySide.debit },
    { amount: 100_000, side: EntrySide.credit },
    { amount: 9_000, side: EntrySide.credit },
  ];

  it('totals a journal by one side', () => {
    expect(voucherTotal(VoucherKind.journal, journal)).toBe(109_000);
  });

  it('totals every other kind by its lines', () => {
    expect(voucherTotal(VoucherKind.receipt, [{ amount: 100 }, { amount: 50.5 }])).toBe(150.5);
  });

  it('accepts a balanced journal', () => {
    expect(journalIsBalanced(journal)).toBe(true);
  });

  it('rejects a journal whose sides differ', () => {
    expect(
      journalIsBalanced([
        { amount: 100, side: EntrySide.debit },
        { amount: 90, side: EntrySide.credit },
      ]),
    ).toBe(false);
  });
});
