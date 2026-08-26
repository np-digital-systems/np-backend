import { assetMaths } from './asset-maths';

describe('assetMaths', () => {
  const acquiredOn = new Date('2020-01-01');
  const asOf = new Date('2026-01-01');

  it('depreciates a straight line over the years held', () => {
    const result = assetMaths(100_000, 10, acquiredOn, null, asOf);

    expect(result.annualDepreciation).toBe(10_000);
    expect(result.accumulatedDepreciation).toBeCloseTo(60_000, -2);
    expect(result.netBookValue).toBeCloseTo(40_000, -2);
  });

  it('never writes an asset below zero', () => {
    const result = assetMaths(100_000, 25, acquiredOn, null, new Date('2040-01-01'));

    expect(result.accumulatedDepreciation).toBe(100_000);
    expect(result.netBookValue).toBe(0);
  });

  it('carries a non-depreciating item at cost', () => {
    const result = assetMaths(5_000_000, 0, acquiredOn, null, asOf);

    expect(result.accumulatedDepreciation).toBe(0);
    expect(result.netBookValue).toBe(5_000_000);
  });

  it('stops depreciating on the disposal date', () => {
    const disposed = assetMaths(100_000, 10, acquiredOn, new Date('2023-01-01'), asOf);

    expect(disposed.accumulatedDepreciation).toBeCloseTo(30_000, -2);
  });
});
