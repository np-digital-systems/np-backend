import { FrequencyType } from '../../generated/prisma/enums';

const LUNAR_OCCURRENCE: Record<number, string> = { 1: 'Valarpirai', 2: 'Theipirai' };

export function describeInstance(
  frequencyType: FrequencyType,
  instanceIdentifier: number,
  customInstanceName?: string | null,
): string {
  if (customInstanceName) return customInstanceName;

  switch (frequencyType) {
    case FrequencyType.weekly:
      return `Week ${instanceIdentifier}`;
    case FrequencyType.monthlyTwice:
      return LUNAR_OCCURRENCE[instanceIdentifier] ?? `Occurrence ${instanceIdentifier}`;
    case FrequencyType.multiDay:
      return `Day ${instanceIdentifier}`;
    case FrequencyType.monthlyOnce:
      return 'Monthly occurrence';
    case FrequencyType.annual:
      return 'Annual occurrence';
  }
}
