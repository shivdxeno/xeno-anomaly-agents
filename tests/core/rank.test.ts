import { describe, expect, it } from 'vitest';

import type { TFinding, TSection } from '../../src/core/types';

import {
  applyRowCap,
  rankFindings,
  scoreSeverity,
  selectTicketable,
} from '../../src/core/services/rank';

const finding = (section: TSection, lossPerDay: number, id: number): TFinding => ({
  grain: 'journey',
  kind: 'volume',
  merchantId: 1509,
  merchantName: 'Tacobell',
  journeyId: id,
  journeyName: `journey ${id}`,
  journeyStatus: 'active',
  triggerIds: [],
  triggerIdsBroken: [],
  was: lossPerDay,
  now: 0,
  changePct: -100,
  startedOn: '2026-09-04',
  lastSeenOn: '2026-09-06',
  stillHappening: true,
  umbrellaSlug: 'journey-stopped-sending',
  shape: 'messages have stopped going out altogether',
  incidentKey: '1509:journey-stopped-sending',
  severity: scoreSeverity(lossPerDay, -100),
  lossPerDay,
  section,
  ticketId: null,
  ticketUrl: null,
  ticketAgeDays: null,
});

describe('severity', () => {
  it('uses the blocker/high/medium scale, never p0/p1/p2', () => {
    expect(scoreSeverity(60000, -70)).toBe('blocker');
    expect(scoreSeverity(12000, -45)).toBe('blocker');
    expect(scoreSeverity(6000, -100)).toBe('blocker');
    expect(scoreSeverity(3000, -70)).toBe('high');
    expect(scoreSeverity(1500, -45)).toBe('medium');
  });

  it('never returns low, because nothing below medium reaches the report', () => {
    expect(['blocker', 'high', 'medium']).toContain(scoreSeverity(1, -51));
  });
});

describe('ranking', () => {
  it('orders by section first, then size within the section', () => {
    const ranked = rankFindings([
      finding('RESOLVED', 90000, 1),
      finding('ONGOING', 80000, 2),
      finding('NEW', 2000, 3),
      finding('NEW', 50000, 4),
    ]);

    expect(ranked.map((f) => f.journeyId)).toEqual([4, 3, 2, 1]);
  });
});

describe('the row cap is spent from the bottom', () => {
  it('never drops a NEW row', () => {
    const findings = [
      ...[1, 2, 3].map((i) => finding('NEW', 10000 - i, i)),
      ...[4, 5].map((i) => finding('ONGOING', 5000, i)),
      ...[6, 7].map((i) => finding('RESOLVED', 5000, i)),
    ];
    const { kept, dropped } = applyRowCap(findings, 4);

    expect(kept.filter((f) => f.section === 'NEW')).toHaveLength(3);
    expect(dropped.every((f) => f.section !== 'NEW')).toBe(true);
  });

  it('drops RESOLVED before ONGOING', () => {
    const findings = [
      finding('NEW', 10000, 1),
      finding('ONGOING', 5000, 2),
      finding('RESOLVED', 9000, 3),
    ];
    const { kept } = applyRowCap(findings, 2);

    expect(kept.map((f) => f.section)).toEqual(['NEW', 'ONGOING']);
  });

  it('keeps every NEW row even when they alone exceed the cap', () => {
    const findings = [1, 2, 3, 4, 5].map((i) => finding('NEW', 1000 * i, i));
    const { kept } = applyRowCap(findings, 3);

    expect(kept).toHaveLength(5);
  });
});

describe('the ticket cap is a different cap from the row cap', () => {
  it('bounds tickets at 10 while the rows still print', () => {
    const findings = Array.from({ length: 25 }, (_, i) => finding('NEW', 1000 + i, i + 1));

    expect(selectTicketable(findings, 10)).toHaveLength(10);
    expect(applyRowCap(findings, 20).kept).toHaveLength(25);
  });

  it('never files a ticket for an ONGOING or RESOLVED row from this path', () => {
    const findings = [finding('ONGOING', 9000, 1), finding('RESOLVED', 9000, 2)];

    expect(selectTicketable(findings, 10)).toHaveLength(0);
  });
});
