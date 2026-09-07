export type TWindow = {
  /** Inclusive, `YYYY-MM-DD`. */
  obsStart: string;
  /** Exclusive — today's date, so today is never evaluated. */
  obsEnd: string;
  /** Inclusive. */
  baseStart: string;
  /** Exclusive; equals `obsStart`. */
  baseEnd: string;
  obsDays: number;
  baseDays: number;
};

const dayMs = 86_400_000;

/**
 * `sent_date` is already an IST calendar date, so the window is calendar arithmetic and must
 * never go through a timezone conversion. Everything here is done on the UTC parts of a
 * date-only value, which is why `runDate` is a `YYYY-MM-DD` string and not a `Date`.
 */
const shiftDays = (isoDate: string, days: number): string => {
  const shifted = new Date(`${isoDate}T00:00:00Z`).getTime() + days * dayMs;

  return new Date(shifted).toISOString().slice(0, 10);
};

export const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Observation is the 3 complete days ending yesterday; baseline is the 14 complete days
 * before that. Both bounds are always closed — rows exist dated year 3023 from a garbage
 * `scheduled_time`, so an open-ended `>= start` poisons every total.
 */
export const computeWindow = (runDate: string, obsDays = 3, baseDays = 14): TWindow => {
  if (!isoDatePattern.test(runDate)) {
    throw new Error(`runDate must be YYYY-MM-DD, got: ${runDate}`);
  }

  const obsStart = shiftDays(runDate, -obsDays);

  return {
    obsStart,
    obsEnd: runDate,
    baseStart: shiftDays(obsStart, -baseDays),
    baseEnd: obsStart,
    obsDays,
    baseDays,
  };
};

/** The last complete day in the window — the day `Still happening` is judged against. */
export const latestObservedDay = (window: TWindow): string => shiftDays(window.obsEnd, -1);

export const isWithinObservation = (date: string, window: TWindow): boolean =>
  date >= window.obsStart && date < window.obsEnd;

export const daysBetween = (from: string, to: string): number =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / dayMs,
  );
