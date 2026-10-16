// Pure costing-resolution rules, kept free of the database so they can be unit-tested.

export interface CostingScope {
  id: number;
  /** Null covers every slot of the type. */
  slotId: number | null;
  /** Null on the first version of a scope, which has always applied. */
  effectiveFrom: Date | null;
  /** Null while still in force. */
  effectiveTo: Date | null;
  /** False for a draft, which never prices anything. */
  isApplied: boolean;
}

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

// Sri Lanka is UTC+05:30 with no DST since 2006, so a temple day runs 18:30 UTC to 18:30 UTC.
const TEMPLE_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function templeDay(on: Date): { from: Date; to: Date } {
  const from = on.getTime() - TEMPLE_OFFSET_MS;

  return { from: new Date(from), to: new Date(from + DAY_MS) };
}

// In force at any point that day. Bounds are half-open so successive versions meet without a gap;
// an open start reaches back indefinitely, so a later costing can price an earlier occurrence.
export function covers(costing: CostingScope, on: Date): boolean {
  const day = templeDay(on);

  if (costing.effectiveFrom && costing.effectiveFrom >= day.to) return false;
  if (costing.effectiveTo && costing.effectiveTo <= day.from) return false;

  return true;
}

// Slot-specific costing beats the type-wide one; among same-day versions the latest wins;
// drafts are never candidates.
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

// The DB exclusion constraint prevents real ties; the id tiebreak keeps the result deterministic anyway.
function mostRecent<T extends CostingScope>(candidates: readonly T[]): T | null {
  if (candidates.length === 0) return null;

  // An open start is the earliest, so any dated version covering the day wins.
  const startedAt = (costing: T) =>
    costing.effectiveFrom ? costing.effectiveFrom.getTime() : Number.NEGATIVE_INFINITY;

  return candidates.reduce((latest, costing) => {
    if (startedAt(costing) > startedAt(latest)) return costing;
    if (startedAt(costing) < startedAt(latest)) return latest;

    return costing.id > latest.id ? costing : latest;
  });
}

export function explainMissingCosting(typeName: string, on: Date): string {
  return (
    `No costing is in force for ${typeName} on ${isoDate(on)}. ` +
    'Set one against the event type, or against this instance if it differs, ' +
    'and mark it active before costing the occurrence.'
  );
}
