import { BadRequestException } from '@nestjs/common';

// Coding is read from the pooja type's activity rather than stored on the costing, so the two can't drift.
export interface PoojaCoding {
  /** Income head for the sponsor's receipt. */
  accountId: number;
  /** Fund for the receipt and every expense line. */
  fundId: number;
  activityId: number;
}

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
