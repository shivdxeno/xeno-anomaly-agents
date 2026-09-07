import type { TFinding, TModuleSpec, TSection } from '../../types';
import type { TWindow } from '../window';

import { changeLabel, formatCount } from '../../utils/numbers';

/**
 * Thirty box-drawing horizontals. Never `---`, which Slack renders as three literal dashes,
 * and never a run of `-` or `=`.
 */
export const divider = '─'.repeat(30);

/**
 * The printed section headings. The internal names are this codebase's classification
 * vocabulary and never reach Slack. A switch rather than a keyed object because the org's
 * `naming-convention` rule requires camelCase object keys.
 */
export const sectionHeading = (section: TSection): string => {
  switch (section) {
    case 'NEW':
      return '🔴 **NEW - tickets opened today**';
    case 'ONGOING':
      return '🟡 **ALREADY BEING WORKED ON** — a ticket is open, full details are on it';
    default:
      return (
        '🟢 **STOPPED ON ITS OWN** — no longer happening, nothing to do, logged for the ' +
        'record as they lie in the baseline window'
      );
  }
};

export type TSectionCounts = { newIssues: number; ongoing: number; resolved: number };

export type TRenderContext = {
  spec: TModuleSpec;
  window: TWindow;
  /** Actual tokens for this run. `null` prints `unavailable` — the line never goes missing. */
  tokensK: number | null;
  runDate: string;
  /** Short clauses appended to the Overview line: the only run-level caveat slot. */
  caveats: Array<string>;
};

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const longDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);

  return `${d} ${monthNames[m - 1]} ${y}`;
};

export const shortDate = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number);

  return `${d} ${monthNames[m - 1].slice(0, 3)}`;
};

/**
 * Three lines, in this order, on EVERY message. The token line is mandatory: a message
 * without it is a defective run even when every number below it is right.
 */
export const renderHeader = (ctx: TRenderContext): Array<string> => {
  const tokens = ctx.tokensK === null ? 'unavailable' : `${ctx.tokensK}k`;

  return [
    `🖌 **${ctx.spec.agentName} — ${longDate(ctx.runDate)}**`,
    `**Tokens - ${tokens}**`,
    divider,
  ];
};

/** The window block and the Overview counts line. First message only. */
export const renderWindowBlock = (ctx: TRenderContext, counts: TSectionCounts): Array<string> => {
  const { window: w } = ctx;
  const obsLast = shortDate(
    new Date(new Date(`${w.obsEnd}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10),
  );
  const baseLast = shortDate(
    new Date(new Date(`${w.baseEnd}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10),
  );
  const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
  const newClause =
    counts.newIssues === 0
      ? 'No new problems found'
      : `${counts.newIssues} new ${plural(counts.newIssues, 'problem', 'problems')} found`;
  const overview = [
    newClause,
    `${counts.ongoing} already being worked on`,
    `${counts.resolved} have stopped by themselves`,
    ...ctx.caveats,
  ].join(' · ');

  return [
    '📊 **Window:**',
    `• **Observation Window** - ${w.obsDays} days (${shortDate(w.obsStart)}–${obsLast}) compared against`,
    `• **2 weeks before** (${shortDate(w.baseStart)} – ${baseLast}).`,
    '',
    `**Overview:** ${overview}.`,
  ];
};

/** A ticket id is always a link when a permalink exists, and bare text when it does not. */
export const renderTicket = (finding: TFinding): string => {
  if (finding.ticketId === null) {
    // Never omitted: the reader must be able to tell "none" from "dropped".
    return finding.section === 'NEW' ? 'not filed (cap) — carries to tomorrow' : 'unknown';
  }

  return finding.ticketUrl === null
    ? finding.ticketId
    : `[${finding.ticketId}](${finding.ticketUrl})`;
};

const identityLine = (finding: TFinding, index: number): string => {
  if (finding.grain === 'merchant') {
    return `**${index}. ${finding.merchantName} (${finding.merchantId})**`;
  }

  return `**${index}. ${finding.merchantName} — ${finding.journeyId} · ${finding.journeyName}**`;
};

const triggerIdField = (finding: TFinding): string => {
  if (finding.triggerIds.length === 0) {
    return '—';
  }

  if (finding.triggerIdsBroken.length === 0) {
    return finding.triggerIds.join(', ');
  }

  return `**${finding.triggerIdsBroken.join(', ')}** (of ${finding.triggerIds.join(', ')})`;
};

/**
 * Every column appears as a named field, in the module's wording, `—` when empty. A run that
 * posts fewer fields than this is a defective run even when every number in it is right.
 */
export const renderBlock = (finding: TFinding, index: number, spec: TModuleSpec): Array<string> => {
  const labels = spec.fieldLabels[finding.kind];
  const lines = [identityLine(finding, index)];

  if (finding.grain === 'journey') {
    lines.push(`• Status: ${finding.journeyStatus ?? '—'} · TriggerId: ${triggerIdField(finding)}`);
  }

  lines.push(`• ${labels.was}: ~${formatCount(finding.was)} ${labels.unit}`);
  lines.push(`• ${labels.now}: ${formatCount(finding.now)}`);
  lines.push(`• Change: ${changeLabel(finding.changePct)}`);
  lines.push(
    `• Began: ${shortDate(finding.startedOn)} · Still happening: ${finding.stillHappening ? 'yes' : 'no'}`,
  );
  lines.push(`• What's going on: ${finding.shape}`);
  lines.push(`• Ticket: ${renderTicket(finding)}`);

  return lines;
};

const identityOneLine = (finding: TFinding): string =>
  finding.grain === 'merchant'
    ? `${finding.merchantName} (${finding.merchantId})`
    : `${finding.merchantName} — ${finding.journeyId} · ${finding.journeyName}`;

/**
 * An ONGOING or RESOLVED line is not a shrunken block: identity, ticket, and one number.
 * No Was, no Now, no Change, no Began, no shape — somebody has already been told, and the id
 * is how they find the rest.
 */
export const renderOneLiner = (finding: TFinding): string => {
  const base = `• ${identityOneLine(finding)} — ${renderTicket(finding)}`;

  if (finding.section === 'ONGOING') {
    return `${base} · open ${finding.ticketAgeDays ?? 0} days`;
  }

  return `${base} · stopped ${shortDate(finding.lastSeenOn)}`;
};

const renderSection = (
  section: TSection,
  findings: Array<TFinding>,
  spec: TModuleSpec,
): Array<string> => {
  const rows = findings.filter((f) => f.section === section);

  if (rows.length === 0) {
    // NEW prints on every run even when empty: a morning with no new breakage is the most
    // useful thing this report can say, and a section that disappears cannot say it.
    return section === 'NEW' ? [`${sectionHeading('NEW')} — none`] : [];
  }

  if (section === 'NEW') {
    const blocks = rows.map((f, i) => renderBlock(f, i + 1, spec).join('\n'));

    return [sectionHeading('NEW'), '', blocks.join('\n\n')];
  }

  return [sectionHeading(section), ...rows.map(renderOneLiner)];
};

const countBySection = (findings: Array<TFinding>): TSectionCounts => ({
  newIssues: findings.filter((f) => f.section === 'NEW').length,
  ongoing: findings.filter((f) => f.section === 'ONGOING').length,
  resolved: findings.filter((f) => f.section === 'RESOLVED').length,
});

const renderTable = (
  heading: string,
  findings: Array<TFinding>,
  spec: TModuleSpec,
): Array<string> => {
  const parts: Array<string> = [`**${heading}**`];

  for (const section of ['NEW', 'ONGOING', 'RESOLVED'] as Array<TSection>) {
    const block = renderSection(section, findings, spec);

    if (block.length > 0) {
      parts.push('', ...block, '', divider);
    }
  }

  return parts;
};

/** Message 1 of 2 — merchants. Carries the window block and the Overview line. */
export const renderMerchantMessage = (findings: Array<TFinding>, ctx: TRenderContext): string => {
  const lines = [
    ...renderHeader(ctx),
    ...renderWindowBlock(ctx, countBySection(findings)),
    '',
    divider,
    '',
    ...renderTable(ctx.spec.tables.merchant, findings, ctx.spec),
    '_Message 1 of 2 — journey-by-journey detail follows._',
  ];

  return lines.join('\n');
};

/** Message 2 of 2. Same header, no window block, and nothing after the last bullet. */
export const renderJourneyMessage = (findings: Array<TFinding>, ctx: TRenderContext): string => {
  const table = renderTable(ctx.spec.tables.journey, findings, ctx.spec);

  // Nothing prints below the journey table: no chronic line, no caveats footer, no third
  // message. The last bullet of the last finding ends the report.
  while (
    table.length > 0 &&
    (table[table.length - 1] === divider || table[table.length - 1] === '')
  ) {
    table.pop();
  }

  return [...renderHeader(ctx), '', ...table].join('\n');
};
