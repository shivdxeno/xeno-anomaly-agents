import { describe, expect, it } from 'vitest';

import { computeWindow, daysBetween, latestObservedDay } from '../../src/core/services/window';

describe('window', () => {
  it('observation is the 3 complete days ending yesterday; today is never evaluated', () => {
    const w = computeWindow('2026-09-07');

    expect(w.obsStart).toBe('2026-09-04');
    expect(w.obsEnd).toBe('2026-09-07');
    expect(latestObservedDay(w)).toBe('2026-09-06');
  });

  it('baseline is the 14 complete days before the observation window', () => {
    const w = computeWindow('2026-09-07');

    expect(w.baseStart).toBe('2026-08-21');
    expect(w.baseEnd).toBe('2026-09-04');
    expect(daysBetween(w.baseStart, w.baseEnd)).toBe(14);
  });

  it('crosses a month boundary without drifting', () => {
    const w = computeWindow('2026-03-02');

    expect(w.obsStart).toBe('2026-02-27');
    expect(w.baseStart).toBe('2026-02-13');
  });

  it('rejects anything that is not an IST calendar date', () => {
    expect(() => computeWindow('07-09-2026')).toThrow(/YYYY-MM-DD/);
  });
});
