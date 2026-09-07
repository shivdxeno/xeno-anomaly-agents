import type { TSection, TSilentDrop, TUmbrella } from '../../types';
import type { TWindow } from '../window';

import { daysBetween, latestObservedDay } from '../window';

/**
 * `IncidentKey` is how the next run finds this ticket: `<merchant_id>:<umbrella-slug>`, two
 * segments, no journey. Tickets are filed at merchant x issue grain, so all of a merchant's
 * affected journeys under one umbrella share one key and one ticket.
 */
export const incidentKey = (merchantId: number, umbrellaSlug: string): string =>
  `${merchantId}:${umbrellaSlug}`;

export const parseIncidentKey = (body: string): string | null => {
  const match = /^IncidentKey:\s*(\d+:[a-z0-9-]+)\s*$/m.exec(body);

  return match === null ? match : match[1];
};

/**
 * Map a raw error string onto the module's closed umbrella list. Never derive a slug from the
 * error text — an unstable slug files duplicates while resolving live tickets as recovered.
 */
export const matchUmbrella = (error: string, umbrellas: Array<TUmbrella>): TUmbrella | null => {
  const exact = umbrellas.find((u) => u.errors.includes(error));

  if (exact !== undefined) {
    return exact;
  }

  const byPrefix = umbrellas.find((u) => u.errorPrefixes.some((p) => error.startsWith(p)));

  return byPrefix ?? null;
};

export type TTicketState = {
  ticketId: string;
  url: string | null;
  stage: string;
  createdDate: string;
  closedDate: string | null;
};

export type TSectionInput = {
  lastSeen: string;
  ticket: TTicketState | null;
};

/**
 * Two questions decide the section, in this order. "Is it still happening?" is asked FIRST:
 * a break whose `last_seen` predates the observation window is RESOLVED whatever DevRev says,
 * because absence of a ticket answers whether anyone filed one while it was live and says
 * nothing about whether it is live now.
 */
export const decideSection = (input: TSectionInput, window: TWindow): TSection => {
  if (input.lastSeen < window.obsStart) {
    return 'RESOLVED';
  }

  if (input.ticket !== null && input.ticket.closedDate === null) {
    return 'ONGOING';
  }

  return 'NEW';
};

export const isStillHappening = (lastSeen: string, window: TWindow): boolean =>
  lastSeen >= latestObservedDay(window);

export const ticketAgeDays = (ticket: TTicketState, runDate: string): number =>
  daysBetween(ticket.createdDate.slice(0, 10), runDate);

export type TCompressedIncident = {
  merchantId: number;
  umbrellaSlug: string;
  journeyIds: Array<number>;
  customers: number;
  firstSeen: string;
  lastSeen: string;
};

/**
 * One error across nineteen journeys is ONE incident, not nineteen. Compression happens
 * before the DevRev lookup so the lookup is keyed on incidents; the journey rows still print
 * separately, because merchant grain does not detect.
 */
export const compressSilentDrops = (
  drops: Array<TSilentDrop>,
  umbrellas: Array<TUmbrella>,
): Array<TCompressedIncident> => {
  const byKey = new Map<string, TCompressedIncident>();

  for (const drop of drops) {
    const umbrella = matchUmbrella(drop.error, umbrellas);
    const slug = umbrella === null ? 'uncategorised' : umbrella.slug;
    const key = incidentKey(drop.merchantId, slug);
    const existing = byKey.get(key);

    if (existing === undefined) {
      byKey.set(key, {
        merchantId: drop.merchantId,
        umbrellaSlug: slug,
        journeyIds: [drop.journeyId],
        customers: drop.customers,
        firstSeen: drop.firstSeen.slice(0, 10),
        lastSeen: drop.lastSeen.slice(0, 10),
      });
      continue;
    }

    if (!existing.journeyIds.includes(drop.journeyId)) {
      existing.journeyIds.push(drop.journeyId);
    }

    existing.customers += drop.customers;
    existing.firstSeen = existing.firstSeen < drop.firstSeen ? existing.firstSeen : drop.firstSeen;
    existing.lastSeen = existing.lastSeen > drop.lastSeen ? existing.lastSeen : drop.lastSeen;
  }

  return [...byKey.values()];
};

/**
 * A silent drop's `Was` is customers per day reaching the failing step, divided by the
 * OBSERVATION days — never the baseline's and never the full window's. An unstated
 * denominator makes the same incident read differently every run.
 */
export const silentDropWasPerDay = (customers: number, window: TWindow): number =>
  window.obsDays > 0 ? customers / window.obsDays : 0;
