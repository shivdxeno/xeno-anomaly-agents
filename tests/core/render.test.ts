import { describe, expect, it } from 'vitest';

import type { TRenderContext } from '../../src/core/services/render';
import type { TFinding, TSection } from '../../src/core/types';

import {
  divider,
  renderBlock,
  renderHeader,
  renderJourneyMessage,
  renderMerchantMessage,
  renderOneLiner,
} from '../../src/core/services/render';
import { computeWindow } from '../../src/core/services/window';
import { journeysModule } from '../../src/modules/journeys/spec';

const ctx = (over: Partial<TRenderContext> = {}): TRenderContext => ({
  spec: journeysModule,
  window: computeWindow('2026-09-07'),
  tokensK: 123,
  runDate: '2026-09-07',
  caveats: [],
  ...over,
});

const merchantFinding = (over: Partial<TFinding> = {}): TFinding => ({
  grain: 'merchant',
  kind: 'volume',
  merchantId: 2509,
  merchantName: 'Subway',
  journeyId: null,
  journeyName: null,
  journeyStatus: null,
  triggerIds: [],
  triggerIdsBroken: [],
  was: 166000,
  now: 0,
  changePct: -100,
  startedOn: '2026-08-23',
  lastSeenOn: '2026-09-06',
  stillHappening: true,
  umbrellaSlug: 'journey-stopped-sending',
  shape: 'messages have stopped going out altogether',
  incidentKey: '2509:journey-stopped-sending',
  severity: 'blocker',
  lossPerDay: 166000,
  section: 'NEW' as TSection,
  ticketId: 'TKT-960',
  ticketUrl: 'https://xenohq.slack.com/archives/C0/p1',
  ticketAgeDays: null,
  ...over,
});

describe('the header', () => {
  it('is exactly three lines: title, token line, divider', () => {
    const lines = renderHeader(ctx());

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('🖌 **Journey Anomaly Agent — 7 September 2026**');
    expect(lines[1]).toBe('**Tokens - 123k**');
    expect(lines[2]).toBe(divider);
  });

  it('prints the token line as unavailable rather than omitting it', () => {
    expect(renderHeader(ctx({ tokensK: null }))[1]).toBe('**Tokens - unavailable**');
  });

  it('repeats the header verbatim on the second message', () => {
    const message = renderJourneyMessage([], ctx());

    expect(
      message.startsWith('🖌 **Journey Anomaly Agent — 7 September 2026**\n**Tokens - 123k**'),
    ).toBe(true);
  });
});

describe('standard markdown, not raw mrkdwn', () => {
  it('bolds with double asterisks', () => {
    const message = renderMerchantMessage([merchantFinding()], ctx());
    const singleAsterisk = /(?<!\*)\*(?!\*)/.exec(message);

    expect(singleAsterisk).toBe(null);
  });

  it('links a ticket as [label](url), never <url|label>', () => {
    const block = renderBlock(merchantFinding(), 1, journeysModule).join('\n');

    expect(block).toContain('[TKT-960](https://xenohq.slack.com/archives/C0/p1)');
    expect(block).not.toContain('|TKT-960>');
  });

  it('prints a bare id when there is no permalink to point at', () => {
    const block = renderBlock(merchantFinding({ ticketUrl: null }), 1, journeysModule).join('\n');

    expect(block).toContain('• Ticket: TKT-960');
  });
});

describe('field labels', () => {
  it('says sends/sending for a volume drop', () => {
    const block = renderBlock(merchantFinding(), 1, journeysModule).join('\n');

    expect(block).toContain('• Normally sends: ~166,000 messages a day');
    expect(block).toContain('• Now sending: 0');
  });

  it('says reaches/reaching for a silent drop, because no message was ever created', () => {
    const silent = merchantFinding({
      kind: 'silent',
      merchantId: 1590,
      merchantName: 'Chai Point',
      was: 5200,
      shape: 'customers drop out before any message is created',
    });
    const block = renderBlock(silent, 1, journeysModule).join('\n');

    expect(block).toContain('• Normally reaches: ~5,200 customers a day');
    expect(block).toContain('• Now reaching: 0');
  });

  it('writes Change in words, never as a signed percentage', () => {
    const block = renderBlock(merchantFinding(), 1, journeysModule).join('\n');

    expect(block).toContain('• Change: down 100%');
    expect(block).not.toContain('-100%');
    expect(block).not.toContain('−100%');
  });

  it('prints every field, so a block is never silently thinner', () => {
    const block = renderBlock(merchantFinding(), 1, journeysModule);

    expect(block).toHaveLength(7);
    expect(block[4]).toBe('• Began: 23 Aug · Still happening: yes');
  });

  it('leads a journey block with Status and TriggerId, with the denominator outside the bold', () => {
    const journey = merchantFinding({
      grain: 'journey',
      journeyId: 1877,
      journeyName: 'NC Offer F1_150-180days',
      journeyStatus: 'active',
      triggerIds: [1, 3, 5],
      triggerIdsBroken: [3, 5],
    });
    const block = renderBlock(journey, 1, journeysModule);

    expect(block[1]).toBe('• Status: active · TriggerId: **3, 5** (of 1, 3, 5)');
  });
});

describe('one-line sections carry identity, ticket and one number', () => {
  it('gives ONGOING the open-age in words', () => {
    const line = renderOneLiner(merchantFinding({ section: 'ONGOING', ticketAgeDays: 5 }));

    expect(line).toBe(
      '• Subway (2509) — [TKT-960](https://xenohq.slack.com/archives/C0/p1) · open 5 days',
    );
  });

  it('gives RESOLVED the date it stopped instead', () => {
    const line = renderOneLiner(merchantFinding({ section: 'RESOLVED', lastSeenOn: '2026-09-01' }));

    expect(line).toContain('· stopped 1 Sep');
  });

  it('carries no Was, Now, Change, Began or shape', () => {
    const line = renderOneLiner(merchantFinding({ section: 'ONGOING', ticketAgeDays: 5 }));

    expect(line).not.toMatch(/Normally|Now sending|Change|Began|going on/);
  });
});

describe('the whole message', () => {
  it('prints the NEW heading even when nothing is under it', () => {
    const message = renderMerchantMessage([], ctx());

    expect(message).toContain('🔴 **NEW - tickets opened today** — none');
  });

  it('opens the Overview with No new problems found when nothing broke', () => {
    const message = renderMerchantMessage([], ctx());

    expect(message).toContain('**Overview:** No new problems found · 0 already being worked on');
  });

  it('appends run-level caveats to the Overview line and nowhere else', () => {
    const message = renderMerchantMessage(
      [],
      ctx({ caveats: ['2 tickets filed without an account'] }),
    );

    expect(message).toContain('· 2 tickets filed without an account');
    expect(message.split('\n').at(-1)).toBe(
      '_Message 1 of 2 — journey-by-journey detail follows._',
    );
  });

  it('states the window it read', () => {
    const message = renderMerchantMessage([], ctx());

    expect(message).toContain('• **Observation Window** - 3 days (4 Sep–6 Sep) compared against');
    expect(message).toContain('• **2 weeks before** (21 Aug – 3 Sep).');
  });

  it('ends the journey message on the last bullet — no footer, no divider', () => {
    const message = renderJourneyMessage(
      [merchantFinding({ grain: 'journey', journeyId: 1 })],
      ctx(),
    );
    const last = message.split('\n').at(-1) ?? '';

    expect(last.startsWith('• Ticket:')).toBe(true);
    expect(message).not.toContain('Message 2 of 2');
  });

  it('gives the journey message no window block and no Overview line', () => {
    const message = renderJourneyMessage([], ctx());

    expect(message).not.toContain('Window:');
    expect(message).not.toContain('Overview:');
  });
});

describe('the ticket id reaches the report', () => {
  it('prints the id once ticketing has run', () => {
    const withId = merchantFinding({ ticketId: 'TKT-1200', ticketUrl: null });

    expect(renderBlock(withId, 1, journeysModule).join('\n')).toContain('• Ticket: TKT-1200');
  });

  it('says not filed (cap) for a NEW row that has no id yet', () => {
    const noId = merchantFinding({ ticketId: null, ticketUrl: null });

    expect(renderBlock(noId, 1, journeysModule).join('\n')).toContain('not filed (cap)');
  });

  it('pluralises the Overview and ends it with a full stop', () => {
    const one = renderMerchantMessage([merchantFinding()], ctx());

    expect(one).toContain('**Overview:** 1 new problem found');
    expect(one).toContain('have stopped by themselves.');
  });
});
