const MS_PER_DAY = 86_400_000;
const round = (value: number) => Math.round(value * 100) / 100;

export interface DepositMaths {
  interestOnMaturity: number;
  maturityValue: number;
  interestAccrued: number;
  daysToMaturity: number;
}

/**
 * Simple interest over the full term, and what has accrued so far.
 *
 * A temple deposit is quoted at a simple annual rate over a fixed tenure, so
 * this is deliberately not a compounding calculation. Accrual is pro-rated by
 * day and never runs past maturity.
 */
export function depositMaths(
  principal: number,
  annualRatePercent: number,
  placedOn: Date,
  maturesOn: Date,
  asOf: Date = new Date(),
): DepositMaths {
  const termDays = Math.max(0, Math.round((maturesOn.getTime() - placedOn.getTime()) / MS_PER_DAY));
  const elapsedDays = Math.min(
    Math.max(0, Math.round((asOf.getTime() - placedOn.getTime()) / MS_PER_DAY)),
    termDays,
  );

  const perDay = (principal * annualRatePercent) / 100 / 365;
  const interestOnMaturity = round(perDay * termDays);

  return {
    interestOnMaturity,
    maturityValue: round(principal + interestOnMaturity),
    interestAccrued: round(perDay * elapsedDays),
    daysToMaturity: Math.ceil((maturesOn.getTime() - asOf.getTime()) / MS_PER_DAY),
  };
}
