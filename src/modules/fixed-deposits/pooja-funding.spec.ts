import { AccountType } from '../../generated/prisma/enums';
import { netExpense, netIncome, poojaFunding } from './pooja-funding';

const sides = (debit: number, credit: number) => ({ debit, credit, count: 1 });

describe('poojaFunding', () => {
  it('leaves a surplus when interest covers the pooja', () => {
    expect(poojaFunding(18_000, 0, 15_500).balance).toBe(2_500);
  });

  it('shows a shortfall when the pooja costs more than it received', () => {
    expect(poojaFunding(9_000, 0, 12_000).balance).toBe(-3_000);
  });

  it('counts sponsor top-ups towards the cost', () => {
    expect(poojaFunding(25_000, 5_000, 30_000).balance).toBe(0);
  });
});

describe('netIncome and netExpense', () => {
  const byType = new Map([
    [AccountType.income, sides(500, 9_500)],
    [AccountType.expense, sides(4_000, 250)],
  ]);

  it('nets income on the credit side', () => {
    expect(netIncome(byType)).toBe(9_000);
  });

  it('nets expense on the debit side', () => {
    expect(netExpense(byType)).toBe(3_750);
  });

  it('is nil when nothing was posted', () => {
    expect(netIncome(undefined)).toBe(0);
    expect(netExpense(new Map())).toBe(0);
  });
});
