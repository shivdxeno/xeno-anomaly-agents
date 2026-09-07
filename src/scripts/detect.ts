import { writeFileSync } from 'node:fs';

import { closeAll } from '../core/db/client';
import { moduleById } from '../core/modules/registry';
import { runDetect } from '../core/pipeline/detect';
import { parseArgs, requireArg, todayIst } from '../core/utils/args';
import { logger } from '../core/utils/logger';

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const spec = moduleById(requireArg(args, 'module'));
  const runDate = typeof args.date === 'string' ? args.date : todayIst();
  const out = typeof args.out === 'string' ? args.out : 'findings.json';
  const findings = await runDetect(spec, runDate);

  writeFileSync(out, `${JSON.stringify(findings, null, 2)}\n`, 'utf8');
  logger.info(
    `detect: ${findings.merchants.length} merchant rows, ${findings.journeys.length} journey rows, ` +
      `${findings.needsJudgment.length} needing judgment -> ${out}`,
  );
};

main()
  .then(closeAll)
  .catch(async (error: unknown) => {
    logger.error(`BLOCKED in detect: ${String(error)}`);
    await closeAll();
    process.exit(1);
  });
