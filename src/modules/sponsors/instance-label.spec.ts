import { FrequencyType } from '../../generated/prisma/enums';
import { describeInstance } from './instance-label';

describe('describeInstance', () => {
  it('numbers the weeks of a weekly event', () => {
    expect(describeInstance(FrequencyType.weekly, 24)).toBe('Week 24');
  });

  it('names the two lunar occurrences of a twice-monthly event', () => {
    expect(describeInstance(FrequencyType.monthly_twice, 1)).toBe('Valarpirai');
    expect(describeInstance(FrequencyType.monthly_twice, 2)).toBe('Theipirai');
  });

  it('falls back to a number for an unexpected lunar occurrence', () => {
    expect(describeInstance(FrequencyType.monthly_twice, 3)).toBe('Occurrence 3');
  });

  it('numbers the days of a festival', () => {
    expect(describeInstance(FrequencyType.multi_day, 3)).toBe('Day 3');
  });

  it('does not number a once-a-month or once-a-year event', () => {
    expect(describeInstance(FrequencyType.monthly_once, 1)).toBe('Monthly occurrence');
    expect(describeInstance(FrequencyType.annual, 1)).toBe('Annual occurrence');
  });

  it("prefers the temple's own name for the day over the derived label", () => {
    expect(describeInstance(FrequencyType.multi_day, 3, 'தேர்')).toBe('தேர்');
    expect(describeInstance(FrequencyType.weekly, 24, 'ஆபரணம்')).toBe('ஆபரணம்');
  });
});
