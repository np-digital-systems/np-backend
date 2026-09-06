import { FrequencyType } from '../../generated/prisma/enums';
import { describeInstance } from './instance-label';

describe('describeInstance', () => {
  it('numbers the weeks of a weekly event', () => {
    expect(describeInstance(FrequencyType.weekly, 24)).toBe('24ஆம் வாரம்');
  });

  it('names the two lunar occurrences of a twice-monthly event', () => {
    expect(describeInstance(FrequencyType.monthly_twice, 1)).toBe('வளர்பிறை');
    expect(describeInstance(FrequencyType.monthly_twice, 2)).toBe('தேய்பிறை');
  });

  it('falls back to a number for an unexpected lunar occurrence', () => {
    expect(describeInstance(FrequencyType.monthly_twice, 3)).toBe('3ஆம் முறை');
  });

  it('numbers the days of a festival', () => {
    expect(describeInstance(FrequencyType.multi_day, 3)).toBe('3ஆம் நாள்');
  });

  it('numbers the months of a once-a-month event, so a 13-month year fits', () => {
    expect(describeInstance(FrequencyType.monthly_once, 1)).toBe('1ஆம் மாதம்');
    expect(describeInstance(FrequencyType.monthly_once, 13)).toBe('13ஆம் மாதம்');
  });

  it('does not number a once-a-year event', () => {
    expect(describeInstance(FrequencyType.annual, 1)).toBe('ஆண்டு நிகழ்வு');
  });

  it("prefers the temple's own name for the day over the derived label", () => {
    expect(describeInstance(FrequencyType.multi_day, 3, 'தேர்')).toBe('தேர்');
    expect(describeInstance(FrequencyType.weekly, 24, 'ஆபரணம்')).toBe('ஆபரணம்');
  });
});
