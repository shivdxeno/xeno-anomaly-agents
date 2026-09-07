import { readFileSync, writeFileSync } from 'node:fs';

import type { TResultsFile } from '../core/stores/query';

import { moduleById } from '../core/modules/registry';
import { planRound1, planRound2, rebindSilentDrops } from '../core/pipeline/queries';
import { parseArgs, requireArg, todayIst } from '../core/utils/args';
import { logger } from '../core/utils/logger';

/**
 * Emits the exact calls the agent must make through its connectors. The script composes every
 * SQL string; the agent only executes and saves.
 *
 *   yarn queries --module=journeys --round=1 --out round1.plan.json
 *   yarn queries --module=journeys --round=2 --results round1.json --out round2.plan.json
 *   yarn queries --module=journeys --round=2 --results round1.json --rebind round2.json
 */
const main = (): void => {
  const args = parseArgs(process.argv.slice(2));
  const spec = moduleById(requireArg(args, 'module'));
  const runDate = typeof args.date === 'string' ? args.date : todayIst();
  const round = args.round === '2' ? 2 : 1;
  const out = typeof args.out === 'string' ? args.out : `round${round}.plan.json`;

  if (round === 1) {
    const plan = planRound1(spec, runDate);

    writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    logger.info(`round 1: ${plan.queries.length} queries + 1 devrev lookup -> ${out}`);

    return;
  }

  const round1 = JSON.parse(readFileSync(requireArg(args, 'results'), 'utf8')) as TResultsFile;
  const plan = planRound2(spec, runDate, round1);

  // 10_silent_drop.sql needs _id values that only exist after journeyIds has run, so its SQL
  // is rebound from the round-2 results rather than guessed at plan time.
  if (typeof args.rebind === 'string') {
    const round2 = JSON.parse(readFileSync(args.rebind, 'utf8')) as TResultsFile;
    const rebound = rebindSilentDrops(plan, round2);

    if (rebound === null) {
      logger.info('nothing to rebind — no journey ids came back');

      return;
    }

    writeFileSync(out, `${JSON.stringify({ ...plan, queries: [rebound] }, null, 2)}\n`, 'utf8');
    logger.info(`rebound silentDrops -> ${out}`);

    return;
  }

  writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  logger.info(`round 2: ${plan.queries.length} queries -> ${out}`);
};

try {
  main();
} catch (error: unknown) {
  logger.error(`BLOCKED in queries: ${String(error)}`);
  process.exit(1);
}
