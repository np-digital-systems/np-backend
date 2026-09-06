import { FrequencyType } from '../../generated/prisma/enums';

const LUNAR_OCCURRENCE: Record<number, string> = { 1: 'வளர்பிறை', 2: 'தேய்பிறை' };

/**
 * What a sponsor with no instance is: registered against the type, waiting for
 * an occurrence. Not "every slot" — the temple takes the name first and settles
 * which Friday it is later, and most of the register sits in this state.
 */
export const ANY_INSTANCE_LABEL = 'Not yet assigned';

/**
 * Which occurrence of the year this is.
 *
 * Tamil, because the calendar is: `name_ta` is the required name and `name_en`
 * the optional one, and these labels are pasted straight into voucher
 * descriptions beside those Tamil names — an English "Annual occurrence"
 * landing mid-sentence in a Tamil receipt line is what gave this away.
 *
 * Months and days are numbered rather than named. Which Tamil month a slot
 * falls in is the temple's to say, not this function's, so it goes in the
 * slot's `custom_instance_name` and wins over anything derived here.
 */
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
