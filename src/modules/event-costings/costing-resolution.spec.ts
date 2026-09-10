import { covers, resolveCosting, type CostingScope } from './costing-resolution';

const costing = (over: Partial<CostingScope> & Pick<CostingScope, 'id'>): CostingScope => ({
  slotId: null,
  effectiveFrom: new Date('2026-04-01'),
  effectiveTo: null,
  ...over,
});

const on = (value: string) => new Date(value);

describe('covers', () => {
  it('includes both ends of the period', () => {
    const version = costing({
      id: 1,
      effectiveFrom: on('2026-04-01'),
      effectiveTo: on('2029-03-31'),
    });

    expect(covers(version, on('2026-04-01'))).toBe(true);
    expect(covers(version, on('2029-03-31'))).toBe(true);
    expect(covers(version, on('2026-03-31'))).toBe(false);
    expect(covers(version, on('2029-04-01'))).toBe(false);
  });

  it('treats an open end as still in force', () => {
    expect(covers(costing({ id: 1, effectiveTo: null }), on('2099-01-01'))).toBe(true);
  });
});

describe('resolveCosting', () => {
  it('prefers the version written for the slot over the one for the type', () => {
    const typeWide = costing({ id: 1, slotId: null });
    const therDay = costing({ id: 2, slotId: 11 });

    expect(resolveCosting([typeWide, therDay], 11, on('2026-06-25'))?.id).toBe(2);
  });

  it('falls back to the type when the slot has none of its own', () => {
    const typeWide = costing({ id: 1, slotId: null });
    const therDay = costing({ id: 2, slotId: 11 });

    expect(resolveCosting([typeWide, therDay], 3, on('2026-06-25'))?.id).toBe(1);
  });

  it('applies a saved costing without anything having to switch it on', () => {
    const saved = costing({ id: 1, slotId: 11 });

    expect(resolveCosting([saved], 11, on('2026-06-25'))?.id).toBe(1);
  });

  it('applies the version in force, not the one that replaced it later', () => {
    const upTo2026 = costing({
      id: 1,
      effectiveFrom: on('2023-04-01'),
      effectiveTo: on('2026-03-31'),
    });
    const revised = costing({ id: 2, effectiveFrom: on('2026-04-01') });

    expect(resolveCosting([upTo2026, revised], 3, on('2025-12-01'))?.id).toBe(1);
    expect(resolveCosting([upTo2026, revised], 3, on('2026-04-01'))?.id).toBe(2);
  });

  it('picks the version in force on the day, not the newest one written', () => {
    const old = costing({
      id: 1,
      effectiveFrom: on('2023-04-01'),
      effectiveTo: on('2026-03-31'),
    });
    const current = costing({ id: 2, effectiveFrom: on('2026-04-01') });

    expect(resolveCosting([old, current], 3, on('2025-08-10'))?.id).toBe(1);
    expect(resolveCosting([old, current], 3, on('2026-08-10'))?.id).toBe(2);
  });

  it('returns null when the date falls before anything was costed', () => {
    expect(resolveCosting([costing({ id: 1 })], 3, on('2020-01-01'))).toBeNull();
  });

  it('is deterministic when two versions of one scope start on the same day', () => {
    const first = costing({ id: 7 });
    const second = costing({ id: 9 });

    expect(resolveCosting([first, second], 3, on('2026-06-25'))?.id).toBe(9);
  });
});
