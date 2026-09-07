import type { TTicketState } from '../services/classify';
import type { TWindow } from '../services/window';
import type { TResultsFile } from '../stores/query';
import type { TFinding, TModuleSpec, TSeries, TSilentDrop } from '../types';

import { resolveThresholds } from '../configs/thresholds';
import {
  compressSilentDrops,
  decideSection,
  incidentKey,
  isStillHappening,
  matchUmbrella,
  silentDropWasPerDay,
  ticketAgeDays,
} from '../services/classify';
import {
  assessBaseline,
  clearsPrintBar,
  isChronicByShape,
  isKnownChronic,
  passesNoiseFloor,
} from '../services/detect';
import { applyRowCap, scoreSeverity } from '../services/rank';
import { computeWindow } from '../services/window';
import { day, num, rowsOf, str } from '../stores/query';
import { changePct } from '../utils/numbers';

export type TJudgmentItem = { kind: string; detail: string };

export type TFindingsFile = {
  module: string;
  runDate: string;
  window: TWindow;
  merchants: Array<TFinding>;
  journeys: Array<TFinding>;
  needsJudgment: Array<TJudgmentItem>;
  caveats: Array<string>;
  droppedRows: number;
};

/** The DevRev lookup result, as the agent saved it. */
export type TTicketsFile = Array<{
  display_id?: string;
  title?: string;
  body?: string;
  stage?: { name?: string; state?: { is_final?: boolean } };
  created_date?: string;
  modified_date?: string;
}>;

type TNameMaps = {
  merchants: Map<number, string>;
  journeys: Map<number, { name: string; status: string }>;
};

type TCtx = {
  spec: TModuleSpec;
  window: TWindow;
  names: TNameMaps;
  tickets: Map<string, TTicketState>;
  runDate: string;
};

const seriesFrom = (row: Record<string, unknown>, isJourney: boolean): TSeries => ({
  merchantId: num(row.merchant_id),
  journeyId: isJourney ? num(row.communication_id) : null,
  obsAttempted: num(row.obs_attempted),
  obsDelivered: num(row.obs_delivered),
  baseAttempted: num(row.base_attempted),
  baseDelivered: num(row.base_delivered),
  baseDays: num(row.base_days),
  daily: [],
});

const buildFinding = (series: TSeries, ctx: TCtx): TFinding | null => {
  const t = resolveThresholds(ctx.spec.thresholds);

  if (!passesNoiseFloor(series, t).passes) {
    return null;
  }

  // Chronic answers "is this an anomaly at all?" and runs before anything else. A known
  // chronic series whose state CHANGED has breached and continues as an ordinary finding.
  if (isChronicByShape(series)) {
    return null;
  }

  const baseline = assessBaseline(series, ctx.window, t);
  const obsDaily = series.obsAttempted / ctx.window.obsDays;

  if (!clearsPrintBar(obsDaily, baseline.comparableDaily, t)) {
    return null;
  }

  const sorted = [...series.daily].sort((a, b) => a.date.localeCompare(b.date));
  const active = sorted.filter((d) => d.attempted > 0);
  const startedOn = active.length > 0 ? active[0].date : ctx.window.obsStart;
  const lastSeenOn = active.length > 0 ? active[active.length - 1].date : ctx.window.obsStart;
  const umbrella = ctx.spec.umbrellas[0];
  const key = incidentKey(series.merchantId, umbrella.slug);
  const ticket = ctx.tickets.get(key) ?? null;
  const pct = changePct(obsDaily, baseline.comparableDaily);
  const lossPerDay = Math.max(baseline.comparableDaily - obsDaily, 0);
  const meta = series.journeyId === null ? undefined : ctx.names.journeys.get(series.journeyId);

  return {
    grain: series.journeyId === null ? 'merchant' : 'journey',
    kind: 'volume',
    merchantId: series.merchantId,
    merchantName: ctx.names.merchants.get(series.merchantId) ?? String(series.merchantId),
    journeyId: series.journeyId,
    journeyName: meta?.name ?? null,
    journeyStatus: meta?.status ?? null,
    triggerIds: [],
    triggerIdsBroken: [],
    was: baseline.comparableDaily,
    now: obsDaily,
    changePct: pct,
    startedOn,
    lastSeenOn,
    stillHappening: isStillHappening(lastSeenOn, ctx.window),
    umbrellaSlug: umbrella.slug,
    shape: umbrella.shape,
    incidentKey: key,
    severity: scoreSeverity(lossPerDay, pct),
    lossPerDay,
    section: decideSection({ lastSeen: lastSeenOn, ticket }, ctx.window),
    ticketId: ticket?.ticketId ?? null,
    ticketUrl: ticket?.url ?? null,
    ticketAgeDays: ticket === null ? null : ticketAgeDays(ticket, ctx.runDate),
  };
};

const silentFinding = (drop: TSilentDrop, ctx: TCtx): TFinding => {
  const umbrella = matchUmbrella(drop.error, ctx.spec.umbrellas);
  const slug = umbrella?.slug ?? 'uncategorised';
  const key = incidentKey(drop.merchantId, slug);
  const ticket = ctx.tickets.get(key) ?? null;
  const was = silentDropWasPerDay(drop.customers, ctx.window);
  const meta = ctx.names.journeys.get(drop.journeyId);
  const lastSeen = drop.lastSeen.slice(0, 10);

  return {
    grain: 'journey',
    kind: 'silent',
    merchantId: drop.merchantId,
    merchantName: ctx.names.merchants.get(drop.merchantId) ?? String(drop.merchantId),
    journeyId: drop.journeyId,
    journeyName: meta?.name ?? null,
    journeyStatus: meta?.status ?? null,
    triggerIds: [],
    triggerIdsBroken: [],
    was,
    now: 0,
    changePct: -100,
    startedOn: drop.firstSeen.slice(0, 10),
    lastSeenOn: lastSeen,
    stillHappening: isStillHappening(lastSeen, ctx.window),
    umbrellaSlug: slug,
    shape: umbrella?.shape ?? 'customers drop out before any message is created',
    incidentKey: key,
    severity: scoreSeverity(was, -100),
    lossPerDay: was,
    section: decideSection({ lastSeen, ticket }, ctx.window),
    ticketId: ticket?.ticketId ?? null,
    ticketUrl: ticket?.url ?? null,
    ticketAgeDays: ticket === null ? null : ticketAgeDays(ticket, ctx.runDate),
  };
};

const ticketMap = (tickets: TTicketsFile, agentName: string): Map<string, TTicketState> => {
  const map = new Map<string, TTicketState>();
  const prefix = `[${agentName}]`;

  for (const ticket of tickets) {
    // The service account is SHARED — humans file test tickets as the same identity — so a
    // row whose title lacks the prefix is discarded. With tags gone this is the only filter.
    if (!String(ticket.title ?? '').startsWith(prefix)) {
      continue;
    }

    const match = /^IncidentKey:\s*(\d+:[a-z0-9-]+)\s*$/m.exec(String(ticket.body ?? ''));

    if (match === null) {
      continue;
    }

    map.set(match[1], {
      ticketId: String(ticket.display_id ?? ''),
      url: null,
      stage: String(ticket.stage?.name ?? ''),
      createdDate: String(ticket.created_date ?? '').slice(0, 10),
      closedDate:
        ticket.stage?.state?.is_final === true
          ? String(ticket.modified_date ?? '').slice(0, 10)
          : null,
    });
  }

  return map;
};

export type TDetectInput = {
  spec: TModuleSpec;
  runDate: string;
  round1: TResultsFile;
  round2: TResultsFile;
  tickets: TTicketsFile;
};

/**
 * Every calculation in the run, over results the agent already fetched. No I/O, no network,
 * no credentials — which is also why the whole thing is testable from a fixture.
 */
export const runDetect = (input: TDetectInput): TFindingsFile => {
  const { spec, runDate } = input;
  const window = computeWindow(runDate);
  const caveats: Array<string> = [];
  const needsJudgment: Array<TJudgmentItem> = [];
  const empty: TFindingsFile = {
    module: spec.id,
    runDate,
    window,
    merchants: [],
    journeys: [],
    needsJudgment,
    caveats,
    droppedRows: 0,
  };

  if (Object.keys(input.round2).length === 0) {
    return { ...empty, caveats: ['no series cleared the noise floor'] };
  }

  const names: TNameMaps = {
    merchants: new Map(rowsOf(input.round2, 'merchantNames').map((r) => [num(r.id), str(r.name)])),
    journeys: new Map(
      rowsOf(input.round2, 'journeyNames').map((r) => [
        num(r.numericId),
        { name: str(r.name), status: str(r.status) },
      ]),
    ),
  };
  const excludedByName = new Set(
    [...names.merchants.entries()]
      .filter(([, name]) => spec.excludedNamePatterns.some((p) => name.includes(p)))
      .map(([id]) => id),
  );
  const tickets = ticketMap(input.tickets, spec.agentName);
  const ctx: TCtx = { spec, window, names, tickets, runDate };
  const keep = (s: TSeries): boolean =>
    !excludedByName.has(s.merchantId) && !spec.excludedMerchantIds.includes(s.merchantId);

  const journeySeries = rowsOf(input.round1, 'journeyWindow').map((r) => seriesFrom(r, true));

  for (const row of rowsOf(input.round2, 'flaggedDaily')) {
    const target = journeySeries.find((s) => s.journeyId === num(row.communication_id));

    target?.daily.push({
      date: day(row.day),
      attempted: num(row.attempted),
      delivered: num(row.delivered),
    });
  }

  const known = journeySeries.filter((s) => isKnownChronic(s, spec.knownChronic));

  if (known.length > 0) {
    caveats.push(`${known.length} known-chronic series gated out`);
  }

  const journeyFindings = journeySeries
    .filter(keep)
    .map((s) => buildFinding(s, ctx))
    .filter((f): f is TFinding => f !== null);

  const idToNumeric = new Map(
    rowsOf(input.round2, 'journeyIds').map((r) => [str(r._id), num(r.numericId)]),
  );
  const numericToMerchant = new Map(journeySeries.map((s) => [s.journeyId ?? 0, s.merchantId]));
  const drops: Array<TSilentDrop> = rowsOf(input.round2, 'silentDrops').flatMap((r) => {
    const numericId = idToNumeric.get(str(r.journeyId));

    if (numericId === undefined) {
      return [];
    }

    return [
      {
        merchantId: numericToMerchant.get(numericId) ?? 0,
        journeyId: numericId,
        stepId: str(r.stepId),
        error: str(r.error),
        customers: num(r.customers),
        firstSeen: str(r.first_seen),
        lastSeen: str(r.last_seen),
      },
    ];
  });

  for (const incident of compressSilentDrops(drops, spec.umbrellas)) {
    if (incident.umbrellaSlug === 'uncategorised') {
      needsJudgment.push({
        kind: 'unmatched-error',
        detail: `merchant ${incident.merchantId}: ${incident.journeyIds.length} journeys in uncategorised`,
      });
    }
  }

  journeyFindings.push(...drops.map((d) => silentFinding(d, ctx)));

  const merchantFindings = rowsOf(input.round1, 'merchantWindow')
    .map((r) => seriesFrom(r, false))
    .filter(keep)
    .filter((s) => names.merchants.has(s.merchantId))
    .map((s) => buildFinding(s, ctx))
    .filter((f): f is TFinding => f !== null);

  const merchantCapped = applyRowCap(merchantFindings, spec.caps.merchantRows);
  const journeyCapped = applyRowCap(journeyFindings, spec.caps.journeyRows);
  const dropped = merchantCapped.dropped.length + journeyCapped.dropped.length;

  if (dropped > 0) {
    caveats.push(`${dropped} rows dropped by the table cap`);
  }

  return {
    module: spec.id,
    runDate,
    window,
    merchants: merchantCapped.kept,
    journeys: journeyCapped.kept,
    needsJudgment,
    caveats,
    droppedRows: dropped,
  };
};
