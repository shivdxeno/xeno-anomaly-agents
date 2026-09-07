import { z } from 'zod';

/** Which of the two ranked tables a finding belongs to. */
export type TGrain = 'merchant' | 'journey';

/**
 * The section a finding prints under. These names are internal vocabulary and never
 * reach Slack — core/services/render owns the printed headings.
 */
export type TSection = 'NEW' | 'ONGOING' | 'RESOLVED';

/** DevRev's severity scale. `low` exists in the org but nothing here ever files it. */
export type TSeverity = 'blocker' | 'high' | 'medium';

/**
 * A volume drop lost messages that were attempted; a silent drop lost customers before
 * any message was created. They are not the same claim and they print different labels.
 */
export type TBreakKind = 'volume' | 'silent';

export const dailyPointSchema = z.object({
  /** IST calendar date, `YYYY-MM-DD`. Never timezone-converted. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  attempted: z.number().nonnegative(),
  delivered: z.number().nonnegative(),
});
export type TDailyPoint = z.infer<typeof dailyPointSchema>;

/**
 * One candidate series as the aggregate queries return it: obs and baseline sums plus the
 * daily points. `baseDays` is per-series and varies — it is both the noise-floor scalar and
 * the divisor for the baseline daily mean.
 */
export const seriesSchema = z.object({
  merchantId: z.number().int().positive(),
  journeyId: z.number().int().positive().nullable(),
  obsAttempted: z.number().nonnegative(),
  obsDelivered: z.number().nonnegative(),
  baseAttempted: z.number().nonnegative(),
  baseDelivered: z.number().nonnegative(),
  baseDays: z.number().int().nonnegative(),
  daily: z.array(dailyPointSchema),
});
export type TSeries = z.infer<typeof seriesSchema>;

/** A silent drop as the step-log detector returns it. */
export const silentDropSchema = z.object({
  merchantId: z.number().int().positive(),
  journeyId: z.number().int().positive(),
  stepId: z.string(),
  error: z.string(),
  customers: z.number().nonnegative(),
  firstSeen: z.string(),
  lastSeen: z.string(),
});
export type TSilentDrop = z.infer<typeof silentDropSchema>;

/** An error-string umbrella: the closed list a module supplies. */
export const umbrellaSchema = z.object({
  /** Lowercase hyphenated; half of the IncidentKey. Append-only in practice. */
  slug: z.string().regex(/^[a-z0-9-]+$/),
  /** The `Issue:` line on the ticket. Never printed in Slack. */
  label: z.string(),
  /** The `What's going on` clause. Plain words, names a shape, never a cause. */
  shape: z.string(),
  /** Exact error strings that map here. */
  errors: z.array(z.string()).default([]),
  /** SQL-style prefixes (`Variable not replaced:`) that map here. */
  errorPrefixes: z.array(z.string()).default([]),
});
export type TUmbrella = z.infer<typeof umbrellaSchema>;

/** A series known to be flat-bad in both windows. Gated out before the DevRev lookup. */
export const chronicEntrySchema = z.object({
  merchantId: z.number().int().positive(),
  /** Empty means the whole merchant is chronic. */
  journeyIds: z.array(z.number().int().positive()).default([]),
  note: z.string(),
});
export type TChronicEntry = z.infer<typeof chronicEntrySchema>;

/** One printed row, after every gate, with everything the renderer and ticketer need. */
export type TFinding = {
  grain: TGrain;
  kind: TBreakKind;
  merchantId: number;
  merchantName: string;
  journeyId: number | null;
  journeyName: string | null;
  journeyStatus: string | null;
  triggerIds: Array<number>;
  triggerIdsBroken: Array<number>;
  was: number;
  now: number;
  changePct: number;
  startedOn: string;
  lastSeenOn: string;
  stillHappening: boolean;
  umbrellaSlug: string;
  shape: string;
  incidentKey: string;
  severity: TSeverity;
  lossPerDay: number;
  section: TSection;
  ticketId: string | null;
  ticketUrl: string | null;
  ticketAgeDays: number | null;
};

/** What a module must supply. Everything here is `[MODULE-SPECIFIC]` in agent.md. */
export type TModuleSpec = {
  id: string;
  /** Goes in the title line and the ticket title prefix. */
  agentName: string;
  /** Routes the ticket to a pod. Must exist in `devrev_pod_mappings.modules`. */
  productModule: string;
  /** Printed heading for each ranked table, cap included. */
  tables: { merchant: string; journey: string };
  /** Row caps, counted across all three sections. */
  caps: { merchantRows: number; journeyRows: number };
  /** Field wording per break kind. */
  fieldLabels: Record<TBreakKind, { was: string; now: string; unit: string }>;
  umbrellas: Array<TUmbrella>;
  knownChronic: Array<TChronicEntry>;
  /** Merchant ids excluded outright (test accounts, internal). */
  excludedMerchantIds: Array<number>;
  /** Substrings in a merchant name that mean "not a real account". */
  excludedNamePatterns: Array<string>;
  /**
   * Plain configuration, not secrets — no token or password belongs in this repo. The DONs
   * come from DevRev admin; the channel is where the report is posted.
   */
  devrev: {
    serviceAccountDon: string;
    appliesToPart: string;
    reportedByDon: string;
    resolvedStage: string;
  };
  slackChannel: { name: string; id: string };
  thresholds?: Partial<TThresholds>;
};

/** Detection and printing thresholds. Core owns the defaults; a module may override. */
export type TThresholds = {
  /** Detection: flag when `obs <= detectRatio * baselineDailyMean`. */
  detectRatio: number;
  /** Printing: a row reaches a table only when `obs < printRatio * baseline`. */
  printRatio: number;
  /** Noise floor, per baseline day. */
  floorAttemptedPerBaseDay: number;
  /** Fewer complete baseline days than this is too little history to judge. */
  minBaseDays: number;
  /** A baseline day this many times the baseline median is a blast, not a norm. */
  blastMedianMultiple: number;
  /** At most this many tickets per run. */
  ticketCap: number;
};
