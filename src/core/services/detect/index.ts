import type { TChronicEntry, TSeries, TThresholds } from '../../types';
import type { TWindow } from '../window';

import { median } from '../../utils/numbers';

export type TFloorVerdict = { passes: boolean; reason?: string };

/**
 * The floor scales with `baseDays`. A flat total is wrong: `baseDays` varies per series, so a
 * flat `base_att >= 14000` drops a healthy journey running 1,500/day with 6 days of history
 * while admitting a 100/day journey with a full 14.
 */
export const passesNoiseFloor = (series: TSeries, t: TThresholds): TFloorVerdict => {
  if (series.baseDays < t.minBaseDays) {
    return { passes: false, reason: `only ${series.baseDays} baseline days` };
  }

  const floor = t.floorAttemptedPerBaseDay * series.baseDays;

  if (series.baseAttempted < floor) {
    return { passes: false, reason: `baseline ${series.baseAttempted} below floor ${floor}` };
  }

  return { passes: true };
};

export const baselineDailyMean = (series: TSeries): number =>
  series.baseDays > 0 ? series.baseAttempted / series.baseDays : 0;

export const observedDailyMean = (series: TSeries, window: TWindow): number =>
  window.obsDays > 0 ? series.obsAttempted / window.obsDays : 0;

export type TBaselineVerdict = {
  distorted: boolean;
  /** The day to compare against: the mean normally, the median when a blast distorted it. */
  comparableDaily: number;
  peakDay?: string;
  peakValue?: number;
  medianValue?: number;
};

/**
 * A baseline mean is not a baseline. One campaign blast inside the baseline inflates the mean
 * and manufactures a collapse that never happened, so compare the observation window to the
 * baseline's typical day whenever a single day dominates.
 */
export const assessBaseline = (
  series: TSeries,
  window: TWindow,
  t: TThresholds,
): TBaselineVerdict => {
  const baseDaily = series.daily.filter(
    (d) => d.date >= window.baseStart && d.date < window.baseEnd,
  );
  const mean = baselineDailyMean(series);

  if (baseDaily.length === 0) {
    return { distorted: false, comparableDaily: mean };
  }

  const values = baseDaily.map((d) => d.attempted);
  const med = median(values);
  const peak = baseDaily.reduce((a, b) => (b.attempted > a.attempted ? b : a));
  const distorted = med > 0 && peak.attempted >= med * t.blastMedianMultiple;

  return {
    distorted,
    comparableDaily: distorted ? med : mean,
    peakDay: peak.date,
    peakValue: peak.attempted,
    medianValue: med,
  };
};

/** Detection bar: what you investigate, not what you print. */
export const clearsDetection = (obsDaily: number, baseDaily: number, t: TThresholds): boolean =>
  baseDaily > 0 && obsDaily <= t.detectRatio * baseDaily;

/** Print bar: a row reaches a table only if its change is worse than the print ratio. */
export const clearsPrintBar = (obsDaily: number, baseDaily: number, t: TThresholds): boolean =>
  baseDaily > 0 && obsDaily < t.printRatio * baseDaily;

const rate = (delivered: number, attempted: number): number =>
  attempted > 0 ? delivered / attempted : 0;

/**
 * Chronic answers a different question from the sections: not "have we reported it?" but "is
 * this an anomaly at all?". A chronic series is flat-bad in the observation window AND the
 * baseline, so nothing changed and nothing fired.
 */
export const isChronicByShape = (series: TSeries): boolean => {
  const obsRate = rate(series.obsDelivered, series.obsAttempted);
  const baseRate = rate(series.baseDelivered, series.baseAttempted);
  const bothDead = series.obsDelivered === 0 && series.baseDelivered === 0;
  const bothFlatLow = obsRate < 0.1 && baseRate < 0.1;

  return series.obsAttempted > 0 && (bothDead || bothFlatLow);
};

/** The inline known-chronic list: gate these before spending a drill-down on them. */
export const isKnownChronic = (series: TSeries, known: Array<TChronicEntry>): boolean =>
  known.some((entry) => {
    if (entry.merchantId !== series.merchantId) {
      return false;
    }

    if (entry.journeyIds.length === 0) {
      return true;
    }

    return series.journeyId !== null && entry.journeyIds.includes(series.journeyId);
  });

/**
 * A known-chronic series whose state CHANGED has breached and is an ordinary finding — the
 * gate runs first so it can ask that, not so it can act as a blocklist.
 */
export const chronicStateChanged = (series: TSeries): boolean => !isChronicByShape(series);
