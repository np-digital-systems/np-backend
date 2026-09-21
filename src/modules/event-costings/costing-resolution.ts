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
  /** Null means still in force; a date means a later version replaced it. */
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

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * A costing covers a date when the date falls inside its period, ends included.
 *
 * An open start reaches backwards for ever, which is what lets a pooja costed
 * in September price the festival that was kept in August.
 */
export function covers(costing: CostingScope, on: Date): boolean {
  const day = isoDate(on);

  if (costing.effectiveFrom && isoDate(costing.effectiveFrom) > day) return false;
  if (costing.effectiveTo && isoDate(costing.effectiveTo) < day) return false;

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
  const startedOn = (costing: T) => (costing.effectiveFrom ? isoDate(costing.effectiveFrom) : '');

  return candidates.reduce((latest, costing) => {
    if (startedOn(costing) > startedOn(latest)) return costing;
    if (startedOn(costing) < startedOn(latest)) return latest;

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
