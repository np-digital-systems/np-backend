/**
 * Which costing applies, and what it comes to.
 *
 * Kept apart from the database so the rule can be read and tested on its own:
 * it is the one piece of this module that decides money, and it decides it
 * from four facts — the scope, the date, the specificity and whether the
 * version was ever applied.
 */

/** The scope and period of a costing, which is all resolution needs of it. */
export interface CostingScope {
  id: number;
  /** Null covers every slot of the type. */
  slotId: number | null;
  /** Null means it has always applied: the first version the scope ever had. */
  effectiveFrom: Date | null;
  /** Null means still in force; an instant is when its successor took over. */
  effectiveTo: Date | null;
  /*
   * False for a draft. A draft carries lines and a period like any other row,
   * and the difference is invisible to every other field — which is exactly
   * why resolution has to be told. Taking it as a boolean rather than the
   * status keeps this module free of the database's spelling: what the rule
   * needs to know is whether the committee applied it, not which of the two
   * applied states it is now in, and `effectiveTo` already answers that.
   */
  isApplied: boolean;
}

/**
 * Sri Lanka keeps UTC+05:30 the year round and has observed no daylight saving
 * since 2006, so the temple's day can be bounded by a constant rather than a
 * timezone library. A scheduled date arrives as UTC midnight of that calendar
 * day, and the day the temple actually kept runs from 18:30 UTC the evening
 * before to 18:30 UTC that evening.
 */
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

const TEMPLE_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instants a calendar date begins and ends at, in the temple's own day. */
export function templeDay(on: Date): { from: Date; to: Date } {
  const from = on.getTime() - TEMPLE_OFFSET_MS;

  return { from: new Date(from), to: new Date(from + DAY_MS) };
}

/**
 * A costing covers a date when it was in force at any point during that day.
 *
 * The bounds are instants and half-open: a version ends at the moment its
 * successor begins, so the two meet without overlapping and without leaving the
 * day between them unpriced. An open start reaches backwards for ever, which is
 * what lets a pooja costed in September price the festival kept in August.
 */
export function covers(costing: CostingScope, on: Date): boolean {
  const day = templeDay(on);

  if (costing.effectiveFrom && costing.effectiveFrom >= day.to) return false;
  if (costing.effectiveTo && costing.effectiveTo <= day.from) return false;

  return true;
}

/**
 * The costing that applies to a slot on a date, or null if none does.
 *
 * Specificity first, date second. A version written for the தேர் day beats the
 * one written for the festival at large, which is the whole reason a slot may
 * carry its own: without that order, an ordinary day's figures would quietly
 * price the biggest day of the year.
 *
 * Where several versions of one scope touched the same day — the committee
 * revised twice in an afternoon — the last of them prices it. That is the
 * figure they had settled on by the time the day was over, and the earlier ones
 * are kept as the record of a decision rather than as a price anybody paid.
 *
 * A draft is not a candidate. It is written, it is saved, and it prices
 * nothing: until the committee applies it, what the temple quotes from is the
 * version it replaces. That is the whole point of drafting one — next year's
 * revision can be argued over while this year's is still being quoted.
 */
export function resolveCosting<T extends CostingScope>(
  candidates: readonly T[],
  slotId: number,
  on: Date,
): T | null {
  const eligible = candidates.filter((costing) => costing.isApplied && covers(costing, on));

  const forThisSlot = eligible.filter((costing) => costing.slotId === slotId);
  const forTheType = eligible.filter((costing) => costing.slotId === null);

  return mostRecent(forThisSlot) ?? mostRecent(forTheType);
}

/**
 * The exclusion constraint permits one version per scope per day, so this only
 * ever picks between rows that cannot both cover the same date. It settles the
 * tie deterministically anyway: a resolver that could return either row is a
 * resolver whose output nobody can reproduce from the data.
 */
function mostRecent<T extends CostingScope>(candidates: readonly T[]): T | null {
  if (candidates.length === 0) return null;

  // An open start is the earliest thing there is, so it loses to any dated
  // version that also covers the day — the later decision is the live one.
  const startedAt = (costing: T) =>
    costing.effectiveFrom ? costing.effectiveFrom.getTime() : Number.NEGATIVE_INFINITY;

  return candidates.reduce((latest, costing) => {
    if (startedAt(costing) > startedAt(latest)) return costing;
    if (startedAt(costing) < startedAt(latest)) return latest;

    return costing.id > latest.id ? costing : latest;
  });
}

/** Why a costing could not be found, in the words the screen should use. */
export function explainMissingCosting(typeName: string, on: Date): string {
  return (
    `No costing is in force for ${typeName} on ${isoDate(on)}. ` +
    'Set one against the event type, or against this instance if it differs, ' +
    'and mark it active before costing the occurrence.'
  );
}
