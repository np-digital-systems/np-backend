/**
 * Which costing applies, and what it comes to.
 *
 * Kept apart from the database so the rule can be read and tested on its own:
 * it is the one piece of this module that decides money, and it decides it
 * from four facts — the scope, the date, the specificity and the status.
 */

/** The scope and period of a costing, which is all resolution needs of it. */
export interface CostingScope {
  id: number;
  /** Null covers every slot of the type. */
  slotId: number | null;
  effectiveFrom: Date;
  /** Null means still in force; a date means a later version replaced it. */
  effectiveTo: Date | null;
}

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

/** A costing covers a date when the date falls inside its period, ends included. */
export function covers(costing: CostingScope, on: Date): boolean {
  const day = isoDate(on);

  if (isoDate(costing.effectiveFrom) > day) return false;
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
 * Every saved costing counts. There is no holding one back: what is written is
 * what applies, until the day it is revised.
 */
export function resolveCosting<T extends CostingScope>(
  candidates: readonly T[],
  slotId: number,
  on: Date,
): T | null {
  const eligible = candidates.filter((costing) => covers(costing, on));

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

  return candidates.reduce((latest, costing) => {
    if (isoDate(costing.effectiveFrom) > isoDate(latest.effectiveFrom)) return costing;
    if (isoDate(costing.effectiveFrom) < isoDate(latest.effectiveFrom)) return latest;

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
