import { deriveEventStatus, isOverdue } from './event-status';

describe('deriveEventStatus', () => {
  const today = new Date('2026-08-12T09:00:00Z');

  it('reports a completed event as completed whatever its date', () => {
    expect(deriveEventStatus(new Date('2026-01-01'), true, today)).toBe('Completed');
    expect(deriveEventStatus(new Date('2027-01-01'), true, today)).toBe('Completed');
  });

  it('reports today’s event as Today', () => {
    expect(deriveEventStatus(new Date('2026-08-12'), false, today)).toBe('Today');
  });

  it('nags about a past event nobody marked done', () => {
    expect(deriveEventStatus(new Date('2026-08-11'), false, today)).toBe('Pending Approval');
    expect(isOverdue(new Date('2026-08-11'), false, today)).toBe(true);
  });

  it('reports a future event as scheduled', () => {
    expect(deriveEventStatus(new Date('2026-08-13'), false, today)).toBe('Scheduled');
    expect(isOverdue(new Date('2026-08-13'), false, today)).toBe(false);
  });

  it('does not call a completed past event overdue', () => {
    expect(isOverdue(new Date('2026-01-01'), true, today)).toBe(false);
  });
});
