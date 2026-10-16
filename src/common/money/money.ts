import { Prisma } from '../../generated/prisma/client';

export type Money = Prisma.Decimal;

export const ZERO = new Prisma.Decimal(0);

export function money(value: string | number | Prisma.Decimal): Money {
  return new Prisma.Decimal(value);
}

// The only rounding point: Decimal arithmetic becomes a JSON number (2 dp) here, at the response boundary.
export function toRupees(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;

  return typeof value === 'number' ? value : value.toDecimalPlaces(2).toNumber();
}

export function toRupeesOrNull(value: Prisma.Decimal | null | undefined): number | null {
  return value === null || value === undefined ? null : toRupees(value);
}

/** Percentage to one decimal; a zero total gives zero. */
export function share(part: Prisma.Decimal | number, total: Prisma.Decimal | number): number {
  const whole = toRupees(total);

  if (whole === 0) return 0;

  return Math.round((toRupees(part) / whole) * 1000) / 10;
}
