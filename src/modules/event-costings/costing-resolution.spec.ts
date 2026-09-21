import { covers, resolveCosting, type CostingScope } from './costing-resolution';

const costing = (over: Partial<CostingScope> & Pick<CostingScope, 'id'>): CostingScope => ({
  slotId: null,
  effectiveFrom: new Date('2026-04-01'),
  effectiveTo: null,
  isApplied: true,
  ...over,
});

const on = (value: string) => new Date(value);

describe('covers', () => {
  it('reaches backwards for ever when it has no start', () => {
    const first = costing({ id: 1, effectiveFrom: null });

    expect(covers(first, on('2020-01-01'))).toBe(true);
    expect(covers(first, on('2099-01-01'))).toBe(true);
  });

  it('stops at its end even with no start', () => {
    const replaced = costing({ id: 1, effectiveFrom: null, effectiveTo: on('2026-09-20') });

    expect(covers(replaced, on('2026-09-20'))).toBe(true);
    expect(covers(replaced, on('2026-09-21'))).toBe(false);
  });

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

  /*
   * The case this was written for: a festival kept in August, costed in
   * September. The first version has no start, so it reaches the day anyway.
   */
  it('prices a day that passed before the costing was written', () => {
    const written = costing({ id: 1, slotId: 11, effectiveFrom: null });

    expect(resolveCosting([written], 11, on('2026-08-18'))?.id).toBe(1);
  });

  it('prefers the dated revision over the open-ended original', () => {
    const original = costing({ id: 1, effectiveFrom: null, effectiveTo: on('2026-09-20') });
    const revised = costing({ id: 2, effectiveFrom: on('2026-09-21') });

    expect(resolveCosting([original, revised], 3, on('2026-08-18'))?.id).toBe(1);
    expect(resolveCosting([original, revised], 3, on('2026-09-25'))?.id).toBe(2);
  });

  it('is deterministic when two versions of one scope start on the same day', () => {
    const first = costing({ id: 7 });
    const second = costing({ id: 9 });

    expect(resolveCosting([first, second], 3, on('2026-06-25'))?.id).toBe(9);
  });
});

describe('resolveCosting, on drafts', () => {
  it('never resolves to a draft, however well it covers the day', () => {
    const draft = costing({ id: 1, effectiveFrom: null, isApplied: false });

    expect(resolveCosting([draft], 7, on('2026-09-21'))).toBeNull();
  });

  it('keeps quoting the applied version while a draft waits beside it', () => {
    const inForce = costing({ id: 1, effectiveFrom: on('2026-04-01') });
    // Same scope, same day, higher id: it would win every tie if it counted.
    const draft = costing({ id: 2, effectiveFrom: on('2026-09-01'), isApplied: false });

    expect(resolveCosting([inForce, draft], 7, on('2026-09-21'))?.id).toBe(1);
  });

  it('ignores a draft written for the slot over an applied type-wide version', () => {
    const typeWide = costing({ id: 1, slotId: null });
    // Specificity would hand it the day, so this is the case that proves the
    // draft is filtered before specificity is considered rather than after.
    const slotDraft = costing({ id: 2, slotId: 7, isApplied: false });

    expect(resolveCosting([typeWide, slotDraft], 7, on('2026-09-21'))?.id).toBe(1);
  });
});
