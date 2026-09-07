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
};
