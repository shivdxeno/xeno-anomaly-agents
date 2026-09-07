import { describe, expect, it } from 'vitest';

import type { TDailyPoint, TSeries } from '../../src/core/types';

import { defaultThresholds } from '../../src/core/configs/thresholds';
import {
  assessBaseline,
  chronicStateChanged,
  clearsPrintBar,
  isChronicByShape,
  isKnownChronic,
  passesNoiseFloor,
} from '../../src/core/services/detect';
import { computeWindow } from '../../src/core/services/window';
import { journeysModule } from '../../src/modules/journeys/spec';

const t = defaultThresholds;
const window = computeWindow('2026-09-07');

const series = (over: Partial<TSeries> = {}): TSeries => ({
  merchantId: 2627,
  journeyId: 2121,
  obsAttempted: 0,
  obsDelivered: 0,
  baseAttempted: 0,
  baseDelivered: 0,
  baseDays: 14,
  daily: [],
  ...over,
});

const days = (from: string, values: Array<number>): Array<TDailyPoint> =>
  values.map((attempted, i) => {
    const date = new Date(new Date(`${from}T00:00:00Z`).getTime() + i * 86_400_000);

    return { date: date.toISOString().slice(0, 10), attempted, delivered: attempted };
  });

describe('noise floor scales with base_days', () => {
  it('keeps a 1,500/day journey that only has 6 baseline days', () => {
    const s = series({ baseDays: 6, baseAttempted: 9000 });

    expect(passesNoiseFloor(s, t).passes).toBe(true);
  });

  it('would have been dropped by a flat 1000 * 14 total floor', () => {
    const s = series({ baseDays: 6, baseAttempted: 9000 });

    expect(s.baseAttempted).toBeLessThan(t.floorAttemptedPerBaseDay * 14);
  });

  it('drops a 100/day journey with a full 14 baseline days', () => {
    expect(passesNoiseFloor(series({ baseDays: 14, baseAttempted: 1400 }), t).passes).toBe(false);
  });

  it('drops anything with fewer than 5 complete baseline days', () => {
    const verdict = passesNoiseFloor(series({ baseDays: 1, baseAttempted: 90000 }), t);

    expect(verdict.passes).toBe(false);
    expect(verdict.reason).toMatch(/1 baseline days/);
  });
});

describe('a baseline mean is not a baseline', () => {
  // Verified 2026-09-07: journey 2121 (INDRIYA 2627) read -83% off a baseline holding one
  // 61,970-row blast on 3 Sep against normal days of 700-2,300, while the observation window
  // ran ~1,500/day — above its true norm. Nothing was broken.
  const baseline = days(
    '2026-08-21',
    [900, 1200, 2300, 700, 1500, 1100, 1800, 2000, 1300, 900, 1600, 1400, 2100, 61970],
  );
  const observation = days('2026-09-04', [1500, 1500, 1500]);
  const journey2121 = series({
    baseDays: 14,
    baseAttempted: baseline.reduce((a, d) => a + d.attempted, 0),
    obsAttempted: 4500,
    daily: [...baseline, ...observation],
  });

  it('flags the baseline as distorted by a single blast day', () => {
    const verdict = assessBaseline(journey2121, window, t);

    expect(verdict.distorted).toBe(true);
    expect(verdict.peakDay).toBe('2026-09-03');
    expect(verdict.peakValue).toBe(61970);
  });

  it('manufactures a large negative against the inflated mean — the false headline', () => {
    // The real series read -83%. These day values are representative, not the production
    // ones, so this asserts the PROPERTY rather than that figure: the mean-based comparison
    // invents a collapse large enough to clear the print bar and lead the report. The exact
    // -83% belongs in tests/modules/journeys/fixtures/ once a real run is frozen there.
    const mean = journey2121.baseAttempted / journey2121.baseDays;
    const obsDaily = journey2121.obsAttempted / window.obsDays;

    expect(((obsDaily - mean) / mean) * 100).toBeLessThan(-70);
    expect(clearsPrintBar(obsDaily, mean, t)).toBe(true);
  });

  it('does not clear the print bar once compared to the typical day', () => {
    const { comparableDaily } = assessBaseline(journey2121, window, t);
    const obsDaily = journey2121.obsAttempted / window.obsDays;

    expect(clearsPrintBar(obsDaily, comparableDaily, t)).toBe(false);
  });

  it('leaves an undistorted baseline on the mean', () => {
    const steady = series({
      baseDays: 14,
      baseAttempted: 14000,
      obsAttempted: 300,
      daily: days('2026-08-21', new Array(14).fill(1000)),
    });

    expect(assessBaseline(steady, window, t).distorted).toBe(false);
    expect(assessBaseline(steady, window, t).comparableDaily).toBe(1000);
  });
});

describe('chronic is a gate, not a section', () => {
  it('treats delivered = 0 in both windows as chronic', () => {
    const s = series({
      obsAttempted: 5000,
      obsDelivered: 0,
      baseAttempted: 70000,
      baseDelivered: 0,
    });

    expect(isChronicByShape(s)).toBe(true);
  });

  it('recognises the inline known-chronic list', () => {
    expect(
      isKnownChronic(series({ merchantId: 1795, journeyId: 178 }), journeysModule.knownChronic),
    ).toBe(true);
    expect(
      isKnownChronic(series({ merchantId: 1795, journeyId: 999 }), journeysModule.knownChronic),
    ).toBe(false);
  });

  it('treats a whole-merchant chronic entry as covering every journey', () => {
    expect(
      isKnownChronic(series({ merchantId: 1791, journeyId: 42 }), journeysModule.knownChronic),
    ).toBe(true);
  });

  it('lets a chronic series that STARTS delivering through as an ordinary finding', () => {
    const recovered = series({
      obsAttempted: 5000,
      obsDelivered: 4000,
      baseAttempted: 70000,
      baseDelivered: 0,
    });

    expect(chronicStateChanged(recovered)).toBe(true);
  });
});
