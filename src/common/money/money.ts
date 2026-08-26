import { Prisma } from '../../generated/prisma/client';

export type Money = Prisma.Decimal;

export const ZERO = new Prisma.Decimal(0);

export function money(value: string | number | Prisma.Decimal): Money {
  return new Prisma.Decimal(value);
}

/**
 * Rupees as a JSON number, rounded to the paisa.
 *
 * Arithmetic stays in `numeric` in Postgres and in `Decimal` here; this is the
 * boundary where it becomes a number for the client, and the only place a
 * rounding decision is made.
 */
export function toRupees(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;

  return typeof value === 'number' ? value : value.toDecimalPlaces(2).toNumber();
}

export function toRupeesOrNull(value: Prisma.Decimal | null | undefined): number | null {
  return value === null || value === undefined ? null : toRupees(value);
}

/** Share of a total, as a percentage rounded to one decimal. Zero total gives zero. */
export function share(part: Prisma.Decimal | number, total: Prisma.Decimal | number): number {
  const whole = toRupees(total);

  if (whole === 0) return 0;

  return Math.round((toRupees(part) / whole) * 1000) / 10;
}
