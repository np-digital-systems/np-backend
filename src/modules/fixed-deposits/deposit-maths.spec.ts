import { depositMaths } from './deposit-maths';

describe('depositMaths', () => {
  const placedOn = new Date('2026-01-01');
  const maturesOn = new Date('2027-01-01');

  it('computes simple interest over the full term', () => {
    const result = depositMaths(1_000_000, 12, placedOn, maturesOn, placedOn);

    expect(result.interestOnMaturity).toBeCloseTo(120_000, 0);
    expect(result.maturityValue).toBeCloseTo(1_120_000, 0);
  });

  it('accrues interest pro rata by day', () => {
    const halfway = new Date('2026-07-02');
    const result = depositMaths(1_000_000, 12, placedOn, maturesOn, halfway);

    expect(result.interestAccrued).toBeGreaterThan(59_000);
    expect(result.interestAccrued).toBeLessThan(61_000);
  });

  it('stops accruing at maturity', () => {
    const late = new Date('2028-01-01');
    const result = depositMaths(1_000_000, 12, placedOn, maturesOn, late);

    expect(result.interestAccrued).toBeCloseTo(result.interestOnMaturity, 0);
  });

  it('reports negative days once a deposit is overdue', () => {
    expect(
      depositMaths(100, 10, placedOn, maturesOn, new Date('2027-02-01')).daysToMaturity,
    ).toBeLessThan(0);
  });

  it('accrues nothing before the placement date', () => {
    expect(depositMaths(100, 10, placedOn, maturesOn, new Date('2025-06-01')).interestAccrued).toBe(
      0,
    );
  });
});
