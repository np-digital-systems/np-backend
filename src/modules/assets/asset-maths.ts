const MS_PER_YEAR = 365.25 * 86_400_000;
const round = (value: number) => Math.round(value * 100) / 100;

export interface AssetMaths {
  ageYears: number;
  annualDepreciation: number;
  accumulatedDepreciation: number;
  netBookValue: number;
}

// Straight-line, floored at zero. A zero rate means no depreciation (land, gold, silver); stops at disposal.
export function assetMaths(
  cost: number,
  annualRatePercent: number,
  acquiredOn: Date,
  disposedOn: Date | null,
  asOf: Date = new Date(),
): AssetMaths {
  const until = disposedOn ?? asOf;
  const ageYears = Math.max(0, (until.getTime() - acquiredOn.getTime()) / MS_PER_YEAR);
  const annualDepreciation = round((cost * annualRatePercent) / 100);
  const accumulated = Math.min(cost, round(annualDepreciation * ageYears));

  return {
    ageYears: Math.round(ageYears * 10) / 10,
    annualDepreciation,
    accumulatedDepreciation: accumulated,
    netBookValue: round(Math.max(0, cost - accumulated)),
  };
}
