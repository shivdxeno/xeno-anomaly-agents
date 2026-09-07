import type { TFindingsFile } from './detect';
import type { TFinding, TModuleSpec } from '../types';

import { devrevTools } from '../services/devrev/tools';
import { selectTicketable } from '../services/rank';
import { shortDate } from '../services/render';
import { formatCount } from '../utils/numbers';

export type TPlannedTicket = {
  action: 'create' | 'comment';
  /** The connector tool the agent calls for this action. */
  tool: string;
  incidentKey: string;
  merchantId: number;
  existingTicketId: string | null;
  title: string;
  body: string;
  comment: string;
  severity: string;
  productModule: string;
  accountDon: string | null;
  revOrgDon: string | null;
  ownerDon: string | null;
};

export type TTicketPlan = {
  module: string;
  runDate: string;
  /** DevRev connector calls, in order. The agent executes these; the script composes them. */
  planned: Array<TPlannedTicket>;
  /** Slack connector calls: the two messages, already rendered. */
  messages: Array<{ tool: string; channel: string; text: string }>;
  suppressedByCap: number;
};

/**
 * `[<Agent>] <Merchant> <id> — <issue> — <N> journeys — started <D MMM>`
 */
const title = (spec: TModuleSpec, group: Array<TFinding>): string => {
  const first = group[0];
  const umbrella = spec.umbrellas.find((u) => u.slug === first.umbrellaSlug);
  const journeys = new Set(group.map((f) => f.journeyId).filter((id) => id !== null)).size;
  const started = group.reduce((a, f) => (f.startedOn < a ? f.startedOn : a), first.startedOn);

  return (
    `[${spec.agentName}] ${first.merchantName} ${first.merchantId} — ` +
    `${umbrella?.label ?? first.umbrellaSlug} — ${journeys} journeys — started ${shortDate(started)}`
  );
};

/** Six lines, hard cap. The detail goes in the comment posted straight after. */
const createBody = (spec: TModuleSpec, group: Array<TFinding>): string => {
  const first = group[0];
  const umbrella = spec.umbrellas.find((u) => u.slug === first.umbrellaSlug);
  const journeys = new Set(group.map((f) => f.journeyId).filter((id) => id !== null)).size;
  const started = group.reduce((a, f) => (f.startedOn < a ? f.startedOn : a), first.startedOn);

  return [
    `Merchant: ${first.merchantName} (${first.merchantId})`,
    `Was: ${formatCount(first.was)}/day · Now: ${formatCount(first.now)} · Change: ${Math.round(first.changePct)}%`,
    `What it looks like: ${first.shape}`,
    `Issue: ${umbrella?.label ?? first.umbrellaSlug}`,
    `Affected journeys: ${journeys} · Started: ${started}`,
    `IncidentKey: ${first.incidentKey}`,
  ].join('\n');
};

const detailComment = (group: Array<TFinding>, findings: TFindingsFile): string => {
  const lines = group
    .filter((f) => f.journeyId !== null)
    .map(
      (f) =>
        `• ${f.journeyId} ${f.journeyName ?? ''} · ${f.journeyStatus ?? '—'} · was ${formatCount(f.was)}/day · now ${formatCount(f.now)}`,
    );

  return [
    `Affected journeys — ${lines.length}:`,
    ...lines,
    '',
    `Window: obs ${findings.window.obsStart} → ${findings.window.obsEnd} · ` +
      `baseline ${findings.window.baseStart} → ${findings.window.baseEnd}`,
  ].join('\n');
};

/**
 * File at merchant x issue grain: one merchant incident is one ticket, however many of its
 * journeys are affected. The plan is written to a file and reviewed before anything is
 * created — this is the last point at which an irreversible action is still reversible.
 */
export type TPlanInput = {
  findings: TFindingsFile;
  spec: TModuleSpec;
  resolution: Map<number, { accountDon: string | null; revOrgDon: string | null }>;
  ownerDon: string | null;
  messages: Array<{ tool: string; channel: string; text: string }>;
};

export const planTickets = (input: TPlanInput): TTicketPlan => {
  const { findings, spec, resolution, ownerDon } = input;
  const all = [...findings.merchants, ...findings.journeys];
  const groups = new Map<string, Array<TFinding>>();

  for (const finding of all) {
    const existing = groups.get(finding.incidentKey);

    if (existing === undefined) {
      groups.set(finding.incidentKey, [finding]);
    } else {
      existing.push(finding);
    }
  }

  const ticketable = selectTicketable(all, spec.thresholds?.ticketCap ?? 10);
  const keys = new Set(ticketable.map((f) => f.incidentKey));
  const planned: Array<TPlannedTicket> = [];

  for (const [key, group] of groups) {
    const first = group[0];
    const isNew = first.section === 'NEW';

    if (isNew && !keys.has(key)) {
      continue;
    }

    if (!isNew && first.section !== 'ONGOING') {
      continue;
    }

    const resolved = resolution.get(first.merchantId);

    planned.push({
      action: isNew ? 'create' : 'comment',
      tool: isNew ? devrevTools.createTicket : devrevTools.addComment,
      incidentKey: key,
      merchantId: first.merchantId,
      existingTicketId: first.ticketId,
      title: title(spec, group),
      body: createBody(spec, group),
      comment: detailComment(group, findings),
      severity: first.severity,
      productModule: spec.productModule,
      accountDon: resolved?.accountDon ?? null,
      revOrgDon: resolved?.revOrgDon ?? null,
      ownerDon,
    });
  }

  const newCount = all.filter((f) => f.section === 'NEW').length;

  return {
    module: findings.module,
    runDate: findings.runDate,
    planned,
    messages: input.messages,
    suppressedByCap: Math.max(newCount - ticketable.length, 0),
  };
};
