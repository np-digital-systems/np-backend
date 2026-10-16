export type EventStatus = 'Completed' | 'Today' | 'Pending Approval' | 'Scheduled';

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

// Derived from completion and the date, never stored.
export function deriveEventStatus(
  scheduledDate: Date,
  isCompleted: boolean,
  today: Date = new Date(),
): EventStatus {
  if (isCompleted) return 'Completed';

  const scheduled = isoDate(scheduledDate);
  const now = isoDate(today);

  if (scheduled === now) return 'Today';
  if (scheduled < now) return 'Pending Approval';

  return 'Scheduled';
}

// A past occurrence not marked done.
export function isOverdue(
  scheduledDate: Date,
  isCompleted: boolean,
  today: Date = new Date(),
): boolean {
  return !isCompleted && isoDate(scheduledDate) < isoDate(today);
}
