import { FrequencyType } from '../../generated/prisma/enums';

const LUNAR_OCCURRENCE: Record<number, string> = { 1: 'Valarpirai', 2: 'Theipirai' };

/** What a sponsor with no instance covers — every slot of the type. */
export const ANY_INSTANCE_LABEL = 'All instances';

export function describeInstance(
  frequencyType: FrequencyType,
  instanceIdentifier: number | null | undefined,
  customInstanceName?: string | null,
): string {
  if (customInstanceName) return customInstanceName;
  if (instanceIdentifier == null) return ANY_INSTANCE_LABEL;

  switch (frequencyType) {
    case FrequencyType.weekly:
      return `Week ${instanceIdentifier}`;
    case FrequencyType.monthly_twice:
      return LUNAR_OCCURRENCE[instanceIdentifier] ?? `Occurrence ${instanceIdentifier}`;
    case FrequencyType.multi_day:
      return `Day ${instanceIdentifier}`;
    case FrequencyType.monthly_once:
      return 'Monthly occurrence';
    case FrequencyType.annual:
      return 'Annual occurrence';
  }
}
