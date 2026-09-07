import { join } from 'node:path';

import type { TWindow } from '../services/window';
import type { TPlannedQuery, TResultsFile } from '../stores/query';
import type { TModuleSpec } from '../types';

import { resolveThresholds } from '../configs/thresholds';
import { passesNoiseFloor } from '../services/detect';
import { devrevTools } from '../services/devrev/tools';
import { computeWindow } from '../services/window';
import { plannedQuery, num, rowsOf, str } from '../stores/query';

/** Stands in for the _id list until `journeyIds` has come back. */
const silentDropPlaceholder = "'PLACEHOLDER_FROM_journeyIds'";

export type TQueryPlan = {
  module: string;
  runDate: string;
  round: 1 | 2;
  window: TWindow;
  queries: Array<TPlannedQuery>;
  /** The connector call the agent must make for the DevRev lookup, on round 1 only. */
  devrevLookup?: { tool: string; args: Record<string, unknown> };
};

const sqlPath = (moduleId: string, file: string): string =>
  join(__dirname, '..', '..', 'modules', moduleId, 'queries', file);

/**
 * Round 1: the platform-wide aggregates, plus the DevRev lookup. Nothing here is scoped to a
 * merchant, because which merchants matter is not known until these come back.
 */
export const planRound1 = (spec: TModuleSpec, runDate: string): TQueryPlan => {
  const window = computeWindow(runDate);
  const bounds = {
    obs_start: window.obsStart,
    base_start: window.baseStart,
    obs_end: window.obsEnd,
  };

  return {
    module: spec.id,
    runDate,
    round: 1,
    window,
    queries: [
      plannedQuery(
        'merchantWindow',
        'starrocks',
        sqlPath(spec.id, '01_merchant_window.sql'),
        bounds,
      ),
      plannedQuery('journeyWindow', 'starrocks', sqlPath(spec.id, '02_journey_window.sql'), bounds),
      plannedQuery('platformDaily', 'starrocks', sqlPath(spec.id, '03_platform_daily.sql'), bounds),
    ],
    devrevLookup: {
      tool: devrevTools.listTickets,
      args: { created_by: [process.env.DEVREV_SERVICE_ACCOUNT_DON ?? ''], limit: 200 },
    },
  };
};

/**
 * Round 2: the drill-downs, scoped to the merchants and journeys round 1 flagged. Aggregate
 * first, resolve names second — the pattern that keeps cross-store joins impossible to write.
 */
export const planRound2 = (
  spec: TModuleSpec,
  runDate: string,
  round1: TResultsFile,
): TQueryPlan => {
  const window = computeWindow(runDate);
  const t = resolveThresholds(spec.thresholds);
  const bounds = {
    obs_start: window.obsStart,
    base_start: window.baseStart,
    obs_end: window.obsEnd,
  };
  const journeyRows = rowsOf(round1, 'journeyWindow');
  const candidates = journeyRows
    .map((r) => ({
      merchantId: num(r.merchant_id),
      journeyId: num(r.communication_id),
      obsAttempted: num(r.obs_attempted),
      obsDelivered: num(r.obs_delivered),
      baseAttempted: num(r.base_attempted),
      baseDelivered: num(r.base_delivered),
      baseDays: num(r.base_days),
      daily: [],
    }))
    .filter((s) => !spec.excludedMerchantIds.includes(s.merchantId))
    .filter((s) => passesNoiseFloor({ ...s, journeyId: s.journeyId }, t).passes);

  const merchantIds = [...new Set(candidates.map((c) => c.merchantId))];
  const journeyIds = candidates.map((c) => c.journeyId);

  if (merchantIds.length === 0) {
    return { module: spec.id, runDate, round: 2, window, queries: [] };
  }

  return {
    module: spec.id,
    runDate,
    round: 2,
    window,
    queries: [
      plannedQuery('merchantNames', 'mysqlProd', sqlPath(spec.id, '04_merchant_names.sql'), {
        merchant_ids: merchantIds,
      }),
      plannedQuery('journeyNames', 'starrocks', sqlPath(spec.id, '05_journey_names.sql'), {
        merchant_ids: merchantIds,
      }),
      plannedQuery('flaggedDaily', 'starrocks', sqlPath(spec.id, '06_flagged_daily.sql'), {
        ...bounds,
        flagged_merchants: merchantIds,
        flagged_journeys: journeyIds,
      }),
      plannedQuery('journeyIds', 'starrocks', sqlPath(spec.id, '09_journey_ids.sql'), {
        merchant_ids: merchantIds,
      }),
      // The only query that sees a failure BEFORE the communication step. Never skipped.
      plannedQuery('silentDrops', 'starrocks', sqlPath(spec.id, '10_silent_drop.sql'), {
        start: window.baseStart,
        end: window.obsEnd,
        id_list: ['PLACEHOLDER_FROM_journeyIds'],
      }),
      plannedQuery('devrevFields', 'mysqlDev', sqlPath(spec.id, '04b_devrev_fields.sql'), {
        merchant_id_rows: merchantIds.map((id) => `SELECT ${id} AS id`).join(' UNION '),
        product_module_lower: spec.productModule.toLowerCase(),
      }),
    ],
  };
};

/**
 * `10_silent_drop.sql` needs `_id` values that only exist once `journeyIds` has run, so its
 * SQL is rebound here rather than guessed at plan time.
 */
export const rebindSilentDrops = (plan: TQueryPlan, round2: TResultsFile): TPlannedQuery | null => {
  const target = plan.queries.find((q) => q.id === 'silentDrops');

  if (target === undefined) {
    return null;
  }

  const ids = rowsOf(round2, 'journeyIds').map((r) => str(r._id));

  if (ids.length === 0) {
    return null;
  }

  return {
    ...target,
    sql: target.sql.replace(silentDropPlaceholder, ids.map((id) => `'${id}'`).join(', ')),
  };
};
