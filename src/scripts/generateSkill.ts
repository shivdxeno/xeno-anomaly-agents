import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TModuleSpec } from '../core/types';

import { logger } from '../core/utils/logger';
import { journeysModule } from '../modules/journeys/spec';

/**
 * Composes a module's SKILL.md from the common instructions plus the module's own. The
 * composed file is generated and never hand-edited: without that rule somebody fixes a common
 * instruction by editing one module's SKILL.md and the fix never reaches the other modules,
 * which is the exact drift the common/module split exists to prevent.
 *
 *   yarn skill:generate            write skills/<module>/SKILL.md
 *   yarn skill:check               exit 1 if the committed file is stale
 */
const repoRoot = join(__dirname, '..', '..');
const modules: Array<TModuleSpec> = [journeysModule];

const banner = (spec: TModuleSpec): string =>
  [
    '<!--',
    '  GENERATED FILE — do not edit.',
    `  Source: instructions/COMMON.md + instructions/modules/${spec.id}/MODULE.md`,
    '  Regenerate with: yarn skill:generate',
    '-->',
    '',
  ].join('\n');

const compose = (spec: TModuleSpec): string => {
  const common = readFileSync(join(repoRoot, 'instructions', 'COMMON.md'), 'utf8');
  const own = readFileSync(join(repoRoot, 'instructions', 'modules', spec.id, 'MODULE.md'), 'utf8');

  return `${banner(spec)}${common.trimEnd()}\n\n---\n\n${own.trimEnd()}\n`;
};

const skillPath = (spec: TModuleSpec): string => join(repoRoot, 'skills', spec.id, 'SKILL.md');

const run = (): number => {
  const check = process.argv.includes('--check');
  let stale = 0;

  for (const spec of modules) {
    const composed = compose(spec);
    const target = skillPath(spec);

    if (!check) {
      writeFileSync(target, composed, 'utf8');
      logger.info(`wrote skills/${spec.id}/SKILL.md (${composed.split('\n').length} lines)`);
      continue;
    }

    const current = readFileSync(target, 'utf8');

    if (current !== composed) {
      logger.error(`STALE: skills/${spec.id}/SKILL.md — run yarn skill:generate`);
      stale += 1;
    }
  }

  if (check && stale === 0) {
    logger.info(`all ${modules.length} skill file(s) up to date`);
  }

  return stale === 0 ? 0 : 1;
};

process.exit(run());
