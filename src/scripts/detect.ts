import { readFileSync, writeFileSync } from 'node:fs';

import type { TTicketsFile } from '../core/pipeline/detect';
import type { TResultsFile } from '../core/stores/query';

import { moduleById } from '../core/modules/registry';
import { runDetect } from '../core/pipeline/detect';
import { parseArgs, requireArg, todayIst } from '../core/utils/args';
import { logger } from '../core/utils/logger';

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));
  const spec = moduleById(requireArg(args, 'module'));
  const out = typeof args.out === 'string' ? args.out : 'findings.json';
  const findings = runDetect({
    spec,
    runDate: typeof args.date === 'string' ? args.date : todayIst(),
    round1: readJson<TResultsFile>(requireArg(args, 'round1')),
    round2: readJson<TResultsFile>(requireArg(args, 'round2')),
    tickets: typeof args.tickets === 'string' ? readJson<TTicketsFile>(args.tickets) : [],
  });

  writeFileSync(out, `${JSON.stringify(findings, null, 2)}\n`, 'utf8');
  logger.info(
    `detect: ${findings.merchants.length} merchant rows, ${findings.journeys.length} journey rows, ` +
      `${findings.needsJudgment.length} needing judgment -> ${out}`,
  );
};

try {
  main();
} catch (error: unknown) {
  logger.error(`BLOCKED in detect: ${String(error)}`);
  process.exit(1);
}
