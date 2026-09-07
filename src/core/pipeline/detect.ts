import { join } from 'node:path';

import type { TTicketState } from '../services/classify';
import type { TWindow } from '../services/window';
import type { TFinding, TModuleSpec, TSeries, TSilentDrop } from '../types';

import { defaultThresholds, resolveThresholds } from '../configs/thresholds';
import { day, loadSql, num, query, str } from '../db/client';
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
import { listAgentTickets } from '../services/devrev/client';
import { applyRowCap, scoreSeverity } from '../services/rank';
import { computeWindow } from '../services/window';
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

const queryPath = (moduleId: string, file: string): string =>
  join(__dirname, '..', '..', 'modules', moduleId, 'queries', file);

const seriesFromRow = (row: Record<string, unknown>, isJourney: boolean): TSeries => ({
  merchantId: num(row.merchant_id),
  journeyId: isJourney ? num(row.communication_id) : null,
  obsAttempted: num(row.obs_attempted),
  obsDelivered: num(row.obs_delivered),
  baseAttempted: num(row.base_attempted),
  baseDelivered: num(row.base_delivered),
  baseDays: num(row.base_days),
  daily: [],
});

const attachDaily = (rows: Array<Record<string, unknown>>, series: Array<TSeries>): void => {
  for (const row of rows) {
    const journeyId = num(row.communication_id);
    const target = series.find((s) => s.journeyId === journeyId);

    target?.daily.push({
      date: day(row.day),
      attempted: num(row.attempted),
      delivered: num(row.delivered),
    });
  }
};

type TNameMaps = {
  merchants: Map<number, string>;
  journeys: Map<number, { name: string; status: string }>;
};

const buildFinding = (
  series: TSeries,
  ctx: {
    spec: TModuleSpec;
    window: TWindow;
    names: TNameMaps;
    tickets: Map<string, TTicketState>;
    runDate: string;
  },
): TFinding | null => {
  const t = resolveThresholds(ctx.spec.thresholds);
  const floor = passesNoiseFloor(series, t);

  if (!floor.passes) {
    return null;
  }

  if (isKnownChronic(series, ctx.spec.knownChronic) && isChronicByShape(series)) {
    return null;
  }

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
  const journeyMeta =
    series.journeyId === null ? undefined : ctx.names.journeys.get(series.journeyId);

  return {
    grain: series.journeyId === null ? 'merchant' : 'journey',
    kind: 'volume',
    merchantId: series.merchantId,
    merchantName: ctx.names.merchants.get(series.merchantId) ?? String(series.merchantId),
    journeyId: series.journeyId,
    journeyName: journeyMeta?.name ?? null,
    journeyStatus: journeyMeta?.status ?? null,
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

const silentFinding = (
  drop: TSilentDrop,
  ctx: {
    spec: TModuleSpec;
    window: TWindow;
    names: TNameMaps;
    tickets: Map<string, TTicketState>;
    runDate: string;
  },
): TFinding => {
  const umbrella = matchUmbrella(drop.error, ctx.spec.umbrellas);
  const slug = umbrella?.slug ?? 'uncategorised';
  const key = incidentKey(drop.merchantId, slug);
  const ticket = ctx.tickets.get(key) ?? null;
  const was = silentDropWasPerDay(drop.customers, ctx.window);
  const meta = ctx.names.journeys.get(drop.journeyId);

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
    lastSeenOn: drop.lastSeen.slice(0, 10),
    stillHappening: isStillHappening(drop.lastSeen.slice(0, 10), ctx.window),
    umbrellaSlug: slug,
    shape: umbrella?.shape ?? 'customers drop out before any message is created',
    incidentKey: key,
    severity: scoreSeverity(was, -100),
    lossPerDay: was,
    section: decideSection({ lastSeen: drop.lastSeen.slice(0, 10), ticket }, ctx.window),
    ticketId: ticket?.ticketId ?? null,
    ticketUrl: ticket?.url ?? null,
    ticketAgeDays: ticket === null ? null : ticketAgeDays(ticket, ctx.runDate),
  };
};

/**
 * The whole deterministic run. Everything the model used to do in-context happens here, in
 * this order, and only the `needsJudgment` array leaves for a model to look at.
 */
export const runDetect = async (spec: TModuleSpec, runDate: string): Promise<TFindingsFile> => {
  const window = computeWindow(runDate);
  const t = resolveThresholds(spec.thresholds);
  const bounds = {
    obs_start: window.obsStart,
    base_start: window.baseStart,
    obs_end: window.obsEnd,
  };
  const caveats: Array<string> = [];
  const needsJudgment: Array<TJudgmentItem> = [];

  const merchantRows = await query(
    'starrocks',
    loadSql(queryPath(spec.id, '01_merchant_window.sql')),
    bounds,
  );
  const journeyRows = await query(
    'starrocks',
    loadSql(queryPath(spec.id, '02_journey_window.sql')),
    bounds,
  );

  const merchantSeries = merchantRows
    .map((r) => seriesFromRow(r, false))
    .filter((s) => !spec.excludedMerchantIds.includes(s.merchantId));
  const journeySeries = journeyRows
    .map((r) => seriesFromRow(r, true))
    .filter((s) => !spec.excludedMerchantIds.includes(s.merchantId));

  const candidateMerchants = [
    ...new Set(journeySeries.filter((s) => passesNoiseFloor(s, t).passes).map((s) => s.merchantId)),
  ];

  if (candidateMerchants.length === 0) {
    return {
      module: spec.id,
      runDate,
      window,
      merchants: [],
      journeys: [],
      needsJudgment: [],
      caveats: ['no series cleared the noise floor'],
      droppedRows: 0,
    };
  }

  const nameRows = await query('mysqlProd', loadSql(queryPath(spec.id, '04_merchant_names.sql')), {
    merchant_ids: candidateMerchants,
  });
  const journeyNameRows = await query(
    'starrocks',
    loadSql(queryPath(spec.id, '05_journey_names.sql')),
    {
      merchant_ids: candidateMerchants,
    },
  );
  const dailyRows = await query('starrocks', loadSql(queryPath(spec.id, '06_flagged_daily.sql')), {
    ...bounds,
    flagged_merchants: candidateMerchants,
    flagged_journeys: journeySeries.map((s) => s.journeyId ?? 0),
  });

  const names: TNameMaps = {
    merchants: new Map(nameRows.map((r) => [num(r.id), str(r.name)])),
    journeys: new Map(
      journeyNameRows.map((r) => [num(r.numericId), { name: str(r.name), status: str(r.status) }]),
    ),
  };

  // Staging and test accounts are excluded by name, which is only knowable after the lookup.
  const excludedByName = new Set(
    [...names.merchants.entries()]
      .filter(([, name]) => spec.excludedNamePatterns.some((p) => name.includes(p)))
      .map(([id]) => id),
  );

  attachDaily(dailyRows, journeySeries);

  const openTickets = await listAgentTickets(spec.agentName);
  const tickets = new Map<string, TTicketState>();

  for (const ticket of openTickets) {
    const match = /^IncidentKey:\s*(\d+:[a-z0-9-]+)\s*$/m.exec(ticket.body);

    if (match !== null) {
      tickets.set(match[1], {
        ticketId: ticket.displayId,
        url: null,
        stage: ticket.stage,
        createdDate: ticket.createdDate,
        closedDate: ticket.closedDate,
      });
    }
  }

  const ctx = { spec, window, names, tickets, runDate };
  const keep = (s: TSeries): boolean => !excludedByName.has(s.merchantId);

  const journeyFindings = journeySeries
    .filter(keep)
    .map((s) => buildFinding(s, ctx))
    .filter((f): f is TFinding => f !== null);

  // Silent drops: the only path that sees a failure before the communication step.
  const idRows = await query('starrocks', loadSql(queryPath(spec.id, '09_journey_ids.sql')), {
    merchant_ids: candidateMerchants,
  });
  const idToNumeric = new Map(idRows.map((r) => [str(r._id), num(r.numericId)]));
  const numericToMerchant = new Map(journeySeries.map((s) => [s.journeyId ?? 0, s.merchantId]));
  const dropRows = await query('starrocks', loadSql(queryPath(spec.id, '10_silent_drop.sql')), {
    start: window.baseStart,
    end: window.obsEnd,
    id_list: [...idToNumeric.keys()],
  });

  const drops: Array<TSilentDrop> = dropRows.flatMap((r) => {
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
        detail: `merchant ${incident.merchantId}: ${incident.journeyIds.length} journeys landed in uncategorised`,
      });
    }
  }

  journeyFindings.push(...drops.map((d) => silentFinding(d, ctx)));

  const merchantFindings = merchantSeries
    .filter(keep)
    .filter((s) => candidateMerchants.includes(s.merchantId))
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
    needsJudgment: needsJudgment,
    caveats,
    droppedRows: dropped,
  };
};

export const thresholdsInUse = defaultThresholds;
