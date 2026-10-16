import { FrequencyType } from '../../generated/prisma/enums';

const LUNAR_OCCURRENCE: Record<number, string> = { 1: 'வளர்பிறை', 2: 'தேய்பிறை' };

// A sponsor with no instance is waiting to be assigned one, not covering every slot.
const ANY_INSTANCE_LABEL = 'Not yet assigned';

// Tamil labels, since they're inserted beside Tamil names in voucher descriptions. Months and days
// are numbered; a slot's custom_instance_name overrides them.
export function describeInstance(
  frequencyType: FrequencyType,
  instanceIdentifier: number | null | undefined,
  customInstanceName?: string | null,
): string {
  if (customInstanceName) return customInstanceName;
  if (instanceIdentifier == null) return ANY_INSTANCE_LABEL;

  switch (frequencyType) {
    case FrequencyType.weekly:
      return `${instanceIdentifier}ஆம் வாரம்`;
    case FrequencyType.monthly_twice:
      return LUNAR_OCCURRENCE[instanceIdentifier] ?? `${instanceIdentifier}ஆம் முறை`;
    case FrequencyType.multi_day:
      return `${instanceIdentifier}ஆம் நாள்`;
    case FrequencyType.monthly_once:
      return `${instanceIdentifier}ஆம் மாதம்`;
    case FrequencyType.annual:
      return 'ஆண்டு நிகழ்வு';
  }
}
