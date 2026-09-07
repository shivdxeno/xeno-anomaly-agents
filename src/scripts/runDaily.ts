import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

import { parseArgs, todayIst } from '../core/utils/args';
import { logger } from '../core/utils/logger';

/**
 * The scheduled entrypoint: one command a cron can invoke. Stages run in order and each reads
 * the previous one's file.
 *
 * ⚑ THE REPORT IS THE DELIVERABLE. Ticketing must never be able to suppress it, so the Slack
 * post runs even when the DevRev stages failed — a morning with a good report and no tickets
 * is a working run with a broken integration; a morning with tickets and no report is an
 * outage nobody hears about.
 */
const run = (script: string, args: Array<string>): void => {
  execFileSync('yarn', [script, ...args], { stdio: 'inherit' });
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));
  const module = typeof args.module === 'string' ? args.module : 'journeys';
  const date = typeof args.date === 'string' ? args.date : todayIst();
  const channel = typeof args.channel === 'string' ? args.channel : process.env.SLACK_CHANNEL_ID;
  const dry = args['dry-run'] === true ? ['--dry-run'] : [];

  if (channel === undefined || channel === '') {
    throw new Error('BLOCKED: --channel or SLACK_CHANNEL_ID is required');
  }

  run('detect', [`--module=${module}`, `--date=${date}`, '--out=findings.json']);

  // Ticketing runs BEFORE rendering so the ticket id can print in the report — but a failure
  // here must never suppress the report, so the render falls back to no ids.
  let ticketsFailed = false;

  try {
    run('tickets:plan', ['--in=findings.json', '--out=plan.json']);
    run('tickets:apply', ['--in=plan.json', '--out=applied.json', ...dry]);
  } catch (error: unknown) {
    ticketsFailed = true;
    logger.warn(`ticketing failed, posting the report anyway: ${String(error)}`);
  }

  const ticketArg = ticketsFailed ? [] : ['--tickets=applied.json'];

  run('render', [
    '--in=findings.json',
    '--out=messages.json',
    `--channel=${channel}`,
    ...ticketArg,
  ]);
  run('post', ['--in=messages.json', ...dry]);

  if (ticketsFailed) {
    logger.warn('run completed with a ticketing failure — see above');
  }

  rmSync('findings.json', { force: true });
  rmSync('messages.json', { force: true });
  rmSync('plan.json', { force: true });
  rmSync('applied.json', { force: true });
};

try {
  main();
} catch (error: unknown) {
  logger.error(`BLOCKED in run:daily: ${String(error)}`);
  process.exit(1);
}
