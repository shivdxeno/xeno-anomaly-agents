import type { TThresholds } from '../types';

/**
 * Detection decides what you investigate; printing decides what a reader sees. The gap
 * between 0.60 and 0.50 is the band you drill into and do not report — that is where a
 * blended journey hiding a dead content variant lives.
 */
export const defaultThresholds: TThresholds = {
  detectRatio: 0.6,
  printRatio: 0.5,

  // A floor of 1,000/day. Multiplied by baseDays at the call site, never applied as a flat
  // total: baseDays varies per series (1, 5, 8, 12, 13 and 14 all appeared in one window),
  // so a flat total drops a healthy 1,500/day journey with 6 days of history.
  floorAttemptedPerBaseDay: 1000,

  // Below 5 complete baseline days there is not enough history to call a change.
  minBaseDays: 5,

  // A single day at 5x the baseline median is a campaign blast, not a norm. Verified
  // 2026-09-07: journey 2121 had one 61,970-row day against normal days of 700-2,300 —
  // roughly 40x the median — and read -83% against the inflated mean while actually
  // running above its true norm.
  blastMedianMultiple: 5,

  // Ten tickets per run. An unticketed NEW finding re-enters tomorrow's run as NEW, so the
  // cap is a draining backlog rather than a drop.
  ticketCap: 10,
};

export const resolveThresholds = (overrides?: Partial<TThresholds>): TThresholds => ({
  ...defaultThresholds,
  ...(overrides ?? {}),
});
