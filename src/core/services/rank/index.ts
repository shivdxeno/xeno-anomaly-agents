import type { TFinding, TSection, TSeverity } from '../../types';

export type TSeverityBand = {
  severity: TSeverity;
  minLossPerDay?: number;
  minDropPct?: number;
  requiresTotalStop?: boolean;
};

/**
 * Severity drives ordering and the DevRev field. The scale is `blocker`/`high`/`medium` —
 * never `p0`/`p1`/`p2`, which is not a scale this org has. Nothing below MEDIUM reaches a
 * ticket because nothing below MEDIUM reaches the report, so `low` is never written.
 */
export const scoreSeverity = (lossPerDay: number, dropPct: number): TSeverity => {
  const drop = Math.abs(dropPct);
  const totalStop = drop >= 99.5;

  if (lossPerDay >= 50000 || (drop >= 40 && lossPerDay >= 10000)) {
    return 'blocker';
  }

  if (totalStop && lossPerDay >= 5000) {
    return 'blocker';
  }

  if (drop >= 60 && lossPerDay >= 2000) {
    return 'high';
  }

  return 'medium';
};

const severityRank = (severity: TSeverity): number => {
  switch (severity) {
    case 'blocker':
      return 0;
    case 'high':
      return 1;
    default:
      return 2;
  }
};

const sectionRank = (section: TSection): number => {
  switch (section) {
    case 'NEW':
      return 0;
    case 'ONGOING':
      return 1;
    default:
      return 2;
  }
};

/**
 * The three sections are the outer order and are not negotiable. WITHIN a section, sort
 * strictly by size so the worst thing in that section is its first row, whatever kind of
 * break it is — sorting by size ACROSS sections is the defect this replaced, which reprinted
 * week-old ticketed incidents as full blocks every morning.
 */
export const rankFindings = (findings: Array<TFinding>): Array<TFinding> =>
  [...findings].sort((a, b) => {
    if (sectionRank(a.section) !== sectionRank(b.section)) {
      return sectionRank(a.section) - sectionRank(b.section);
    }

    if (severityRank(a.severity) !== severityRank(b.severity)) {
      return severityRank(a.severity) - severityRank(b.severity);
    }

    return b.lossPerDay - a.lossPerDay;
  });

export type TCapResult = {
  kept: Array<TFinding>;
  dropped: Array<TFinding>;
};

/**
 * The cap is spent from the bottom: drop RESOLVED lines first, then ONGOING. A NEW row is
 * never dropped — a cap that evicts today's news to make room for a one-liner about a break
 * that has stopped has inverted the point of the sections.
 */
export const applyRowCap = (findings: Array<TFinding>, cap: number): TCapResult => {
  const ranked = rankFindings(findings);

  if (ranked.length <= cap) {
    return { kept: ranked, dropped: [] };
  }

  const newRows = ranked.filter((f) => f.section === 'NEW');
  const ongoing = ranked.filter((f) => f.section === 'ONGOING');
  const resolved = ranked.filter((f) => f.section === 'RESOLVED');
  const budget = Math.max(cap - newRows.length, 0);
  const keptOngoing = ongoing.slice(0, budget);
  const keptResolved = resolved.slice(0, Math.max(budget - keptOngoing.length, 0));
  const kept = rankFindings([...newRows, ...keptOngoing, ...keptResolved]);
  const keptSet = new Set(kept);

  return { kept, dropped: ranked.filter((f) => !keptSet.has(f)) };
};

/**
 * The ticket cap is a different cap from the row cap: this one governs tickets filed, the row
 * cap governs rows printed. A NEW finding the ticket cap suppressed still prints, and
 * re-enters tomorrow's run as NEW.
 */
export const selectTicketable = (findings: Array<TFinding>, cap: number): Array<TFinding> =>
  rankFindings(findings.filter((f) => f.section === 'NEW')).slice(0, cap);
