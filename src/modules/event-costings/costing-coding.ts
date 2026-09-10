import { BadRequestException } from '@nestjs/common';

/**
 * Where a pooja's money is coded, worked out rather than asked for again.
 *
 * The temple already answers this once, on the activity a pooja type points at:
 * the head a receipt for it lands on, and the fund it is held in. The costing
 * reads that answer instead of keeping its own, because a fact stored in two
 * places is a fact that eventually disagrees with itself — somebody edits the
 * activity, the costing keeps the old head, and no screen can say which is right.
 */
export interface PoojaCoding {
  /** The income head a sponsor's receipt lands on. */
  accountId: number;
  /** The fund it is held in, and the one every expense line is carried in. */
  fundId: number;
  activityId: number;
}

/** What is missing, in the words the screen should use. */
export function explainMissingCoding(typeName: string, activityNamed: boolean): string {
  if (!activityNamed) {
    return (
      `${typeName} has no activity, so there is nowhere to read its coding from. ` +
      'Set one on the pooja type, then give that activity its income head and fund ' +
      'under Accounting → Activities.'
    );
  }

  return (
    `The activity behind ${typeName} has no income head or fund set. ` +
    'Set them under Accounting → Activities and every receipt for this pooja ' +
    'will be coded the same way, this one included.'
  );
}

export function requireCoding(
  coding: PoojaCoding | null,
  typeName: string,
  activityNamed: boolean,
): PoojaCoding {
  if (!coding) throw new BadRequestException(explainMissingCoding(typeName, activityNamed));

  return coding;
}
