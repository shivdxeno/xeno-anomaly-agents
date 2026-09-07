import { readFileSync, writeFileSync } from 'node:fs';

import type { TFindingsFile } from '../core/pipeline/detect';
import type { TRenderContext } from '../core/services/render';
import type { TResultsFile } from '../core/stores/query';

import { moduleById } from '../core/modules/registry';
import { planTickets } from '../core/pipeline/tickets';
import { slackTools } from '../core/services/devrev/tools';
import { renderJourneyMessage, renderMerchantMessage } from '../core/services/render';
import { num, rowsOf, str } from '../core/stores/query';
import { parseArgs, requireArg } from '../core/utils/args';
import { logger } from '../core/utils/logger';

/**
 * The last script in the run. Produces every WRITE the agent must make — the two Slack
 * messages and the DevRev creates and comments — as a plan the agent executes verbatim.
 *
 * ⚑ A plan is not a write. This is the last point at which an irreversible action is still
 * reversible, so read it before executing.
 */
const main = (): void => {
  const args = parseArgs(process.argv.slice(2));
  const findings = JSON.parse(readFileSync(requireArg(args, 'in'), 'utf8')) as TFindingsFile;
  const spec = moduleById(findings.module);
  const out = typeof args.out === 'string' ? args.out : 'plan.json';
  // A test run posts somewhere private AND files nothing. Those two belong together: a report
  // in a DM with real tickets filed against real merchants is the worst of both.
  const test = args.test === true;
  const override = typeof args.channel === 'string' ? args.channel : null;

  // On a test run the target is a person's NAME, which the agent resolves to a DM through the
  // Slack connector. On a real run it is a channel id and there is nothing to resolve.
  const dmUserName = test && override === null ? spec.slackChannel.testDmUserName : null;
  const channel = dmUserName === null ? (override ?? spec.slackChannel.id) : null;

  if (channel === '') {
    throw new Error(
      'BLOCKED: no Slack channel id. Pass --channel, or fill slackChannel.id in ' +
        `src/modules/${spec.id}/spec.ts (the channel is #${spec.slackChannel.name}).`,
    );
  }
  const resolution = new Map<number, { accountDon: string | null; revOrgDon: string | null }>();
  let ownerDon: string | null = null;

  // The devrev_* mapping tables live on DEV MySQL and were fetched in round 2.
  if (typeof args.round2 === 'string') {
    const round2 = JSON.parse(readFileSync(args.round2, 'utf8')) as TResultsFile;

    for (const row of rowsOf(round2, 'devrevFields')) {
      if (str(row.kind) === 'owner') {
        ownerDon = str(row.account_don) === '' ? null : str(row.account_don);
        continue;
      }

      resolution.set(num(row.key_col), {
        accountDon: str(row.account_don) === '' ? null : str(row.account_don),
        revOrgDon: str(row.rev_org_don) === '' ? null : str(row.rev_org_don),
      });
    }
  }

  const caveatArg = typeof args.caveat === 'string' ? [args.caveat] : [];
  const ctx: TRenderContext = {
    spec,
    window: findings.window,
    tokensK: typeof args.tokens === 'string' ? Number(args.tokens) : null,
    runDate: findings.runDate,
    caveats: [...findings.caveats, ...caveatArg],
  };
  const plan = planTickets({
    findings,
    spec,
    resolution,
    ownerDon,
    messages: [
      {
        tool: slackTools.sendMessage,
        channel,
        dmUserName,
        text: renderMerchantMessage(findings.merchants, ctx),
      },
      {
        tool: slackTools.sendMessage,
        channel,
        dmUserName,
        text: renderJourneyMessage(findings.journeys, ctx),
      },
    ],
  });
  const merchantIds = [
    ...new Set([...findings.merchants, ...findings.journeys].map((f) => f.merchantId)),
  ];
  const missing = merchantIds.filter((id) => (resolution.get(id)?.accountDon ?? null) === null);

  const output = test ? { ...plan, planned: [], testRun: true } : plan;

  writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  logger.info(
    `plan: 2 messages, ${output.planned.length} devrev calls, ` +
      `${plan.suppressedByCap} suppressed by cap -> ${out}`,
  );

  if (test) {
    logger.warn(
      `TEST RUN: DM to ${dmUserName ?? channel} and filing NOTHING — ${plan.planned.length} ` +
        'devrev calls were dropped from the plan.',
    );
  }

  if (missing.length > 0) {
    logger.warn(
      `no DevRev account mapping for merchants ${missing.join(', ')} — filing without account`,
    );
  }
};

try {
  main();
} catch (error: unknown) {
  logger.error(`BLOCKED in plan: ${String(error)}`);
  process.exit(1);
}
