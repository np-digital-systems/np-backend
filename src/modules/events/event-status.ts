export type EventStatus = 'Completed' | 'Today' | 'Pending Approval' | 'Scheduled';

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * An event's status is read off the calendar, never stored.
 *
 * Two facts decide it: whether somebody marked it done, and where its date sits
 * relative to today. Nothing else can drift out of step with the calendar.
 */
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

/** A past occurrence nobody marked done — the one thing the calendar should nag about. */
export function isOverdue(
  scheduledDate: Date,
  isCompleted: boolean,
  today: Date = new Date(),
): boolean {
  return !isCompleted && isoDate(scheduledDate) < isoDate(today);
}
