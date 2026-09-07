import { describe, expect, it } from 'vitest';

import type { TTicketState } from '../../src/core/services/classify';
import type { TSilentDrop } from '../../src/core/types';

import {
  compressSilentDrops,
  decideSection,
  incidentKey,
  isStillHappening,
  matchUmbrella,
  parseIncidentKey,
  silentDropWasPerDay,
} from '../../src/core/services/classify';
import { computeWindow } from '../../src/core/services/window';
import { journeyUmbrellas } from '../../src/modules/journeys/umbrellas';

const window = computeWindow('2026-09-07');

const openTicket: TTicketState = {
  ticketId: 'TKT-1053',
  url: null,
  stage: 'queued',
  createdDate: '2026-09-02',
  closedDate: null,
};

describe('section truth table', () => {
  // The 2026-08-31 regression: four merchants and fourteen journeys led the report under NEW,
  // every one last seen 18-27 Aug — before the observation window opened. NEW was keyed on
  // "no ticket exists", which says nothing about whether the break is live now.
  it('is RESOLVED when last_seen predates the window, even with no ticket ever', () => {
    expect(decideSection({ lastSeen: '2026-08-27', ticket: null }, window)).toBe('RESOLVED');
  });

  it('is RESOLVED when last_seen predates the window even with an open ticket', () => {
    expect(decideSection({ lastSeen: '2026-08-27', ticket: openTicket }, window)).toBe('RESOLVED');
  });

  it('is ONGOING when still happening and a ticket is open', () => {
    expect(decideSection({ lastSeen: '2026-09-06', ticket: openTicket }, window)).toBe('ONGOING');
  });

  it('is NEW when still happening and no ticket has ever been filed', () => {
    expect(decideSection({ lastSeen: '2026-09-06', ticket: null }, window)).toBe('NEW');
  });

  it('is NEW again when the only ticket is closed', () => {
    const closed = { ...openTicket, closedDate: '2026-09-01' };

    expect(decideSection({ lastSeen: '2026-09-06', ticket: closed }, window)).toBe('NEW');
  });

  it('judges Still happening against the last COMPLETE day', () => {
    expect(isStillHappening('2026-09-06', window)).toBe(true);
    expect(isStillHappening('2026-09-05', window)).toBe(false);
  });
});

describe('IncidentKey', () => {
  it('is merchant x issue — two segments, no journey', () => {
    expect(incidentKey(1509, 'intermediate-processing-failing')).toBe(
      '1509:intermediate-processing-failing',
    );
  });

  it('round-trips out of a ticket body', () => {
    const body = 'Merchant: Tacobell (1509)\nIncidentKey: 1509:api-503\nAffected journeys: 6';

    expect(parseIncidentKey(body)).toBe('1509:api-503');
  });

  it('returns null rather than guessing when the line is absent', () => {
    expect(parseIncidentKey('Merchant: Tacobell (1509)')).toBe(null);
  });
});

describe('umbrella matching is a closed list', () => {
  it('matches an exact error string', () => {
    const u = matchUmbrella('Request failed with status code 503', journeyUmbrellas);

    expect(u?.slug).toBe('intermediate-processing-failing');
  });

  it('matches by prefix', () => {
    const u = matchUmbrella('connect ECONNREFUSED 10.0.0.4:443', journeyUmbrellas);

    expect(u?.slug).toBe('intermediate-processing-failing');
  });

  it('returns null for an unknown error rather than the nearest-looking row', () => {
    expect(matchUmbrella('some brand new error', journeyUmbrellas)).toBe(null);
  });
});

describe('shared-event compression', () => {
  const drop = (journeyId: number, error: string, customers: number): TSilentDrop => ({
    merchantId: 2509,
    journeyId,
    stepId: 'step-uuid',
    error,
    customers,
    firstSeen: '2026-09-04',
    lastSeen: '2026-09-06',
  });

  it('collapses one error across many journeys into ONE incident', () => {
    const drops = [1, 2, 3].map((j) => drop(j, 'Request failed with status code 503', 100));
    const incidents = compressSilentDrops(drops, journeyUmbrellas);

    expect(incidents).toHaveLength(1);
    expect(incidents[0].journeyIds).toEqual([1, 2, 3]);
    expect(incidents[0].customers).toBe(300);
  });

  it('files an unmatched error under uncategorised instead of dropping it', () => {
    const incidents = compressSilentDrops([drop(1, 'brand new error', 5)], journeyUmbrellas);

    expect(incidents[0].umbrellaSlug).toBe('uncategorised');
  });
});

describe('silent-drop Was divisor', () => {
  // TKT-1054 used 4,555 / 3. An unstated denominator makes the same incident read
  // differently every run.
  it('divides by the observation days, not the baseline or the full window', () => {
    expect(Math.round(silentDropWasPerDay(4555, window))).toBe(1518);
  });
});
