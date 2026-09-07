import type { TModuleSpec } from '../../core/types';

import { journeyUmbrellas } from './umbrellas';

/**
 * The `[MODULE-SPECIFIC]` half of agent.md, as data. Everything here is Journey's; everything
 * that consumes it lives in `src/core` and is shared with every other module.
 */
export const journeysModule: TModuleSpec = {
  id: 'journeys',
  agentName: 'Journey Anomaly Agent',

  // Verified present in devrev_pod_mappings.modules under pod MA. Any value not in that
  // table routes every ticket to Unassigned.
  productModule: 'Journeys',

  tables: {
    merchant: 'MERCHANTS AFFECTED — top 10',
    journey: 'JOURNEYS AFFECTED — top 20',
  },

  // The journey table is the detector and carries the silent drops too, so it needs the extra
  // room; the merchant table is triage order and 10 is plenty.
  caps: { merchantRows: 10, journeyRows: 20 },

  fieldLabels: {
    volume: { was: 'Normally sends', now: 'Now sending', unit: 'messages a day' },
    silent: { was: 'Normally reaches', now: 'Now reaching', unit: 'customers a day' },
  },

  umbrellas: journeyUmbrellas,

  // Verified chronic 2026-09-07: flat-bad in the observation window AND the baseline, so
  // nothing changed and nothing fired. Gate them before spending a drill-down — but still
  // check whether the state CHANGED, which is why the gate runs first.
  knownChronic: [
    {
      merchantId: 1795,
      journeyIds: [176, 178, 179],
      note: 'SACO: delivered = 0 while attempted is healthy',
    },
    { merchantId: 1791, journeyIds: [], note: 'delivered = 0 in observation and baseline' },
    {
      merchantId: 1590,
      journeyIds: [1390, 1391, 1392, 1393],
      note: 'Chai Point: delivery rate 1.7-7.9% in both windows',
    },
  ],

  excludedMerchantIds: [120, 1671],
  excludedNamePatterns: ['Staging', 'Testing', 'V2 Staging'],

  // Verified 2026-09-07 against live ticket payloads. The org is dvrv-in-1, tenant
  // devo/2CB1Ol9rdd; PROD-1 is the only part any ticket in the org uses. Support Bot is a
  // SHARED identity, which is why the lookup also discards titles lacking the agent prefix.
  devrev: {
    serviceAccountDon: 'don:identity:dvrv-in-1:devo/2CB1Ol9rdd:devu/19',
    appliesToPart: 'don:core:dvrv-in-1:devo/2CB1Ol9rdd:product/1',
    reportedByDon: 'don:identity:dvrv-in-1:devo/2CB1Ol9rdd:devu/19',
    resolvedStage: 'resolved',
  },

  // ⚑ The id is UNKNOWN and must be filled before the first run. The channel NAME is from
  // agent.md; nobody has stated its id, and inventing one posts the report into silence.
  slackChannel: {
    name: 'proj-data-anomaly-alerting-agents',
    id: '',
    // Shiv Deshpande's DM, for test runs. UNKNOWN — Slack profile → ⋮ → Copy member ID.
    testDmId: '',
  },
};
