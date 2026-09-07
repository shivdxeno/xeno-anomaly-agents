import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

/** The skill name a routine triggers on. Lowercase, hyphenated, max 64 chars. */
const skillName = (spec: TModuleSpec): string => `${spec.id}-anomaly-agent`;

/**
 * YAML frontmatter is what makes this an Agent Skill rather than a markdown file: Claude Code
 * preloads only `name` and `description`, and reads the body when the description matches the
 * task. Without it the file is never discovered.
 */
const banner = (spec: TModuleSpec): string =>
  [
    '---',
    `name: ${skillName(spec)}`,
    'description: >-',
    `  Runs the ${spec.agentName}: detects anomalies in ${spec.id} communications for the fixed`,
    '  daily window, posts the two-message report to Slack and files DevRev tickets at merchant',
    `  x issue grain. Use when asked to run the ${spec.id} anomaly agent, produce the daily`,
    `  ${spec.id} anomaly report, or investigate a drop in ${spec.id} sending or delivery.`,
    '---',
    '',
    '<!--',
    '  GENERATED FILE — do not edit. Run `yarn skill:generate`.',
    `  Source: instructions/COMMON.md + instructions/modules/${spec.id}/MODULE.md`,
    '-->',
    '',
  ].join('\n');

const compose = (spec: TModuleSpec): string => {
  const common = readFileSync(join(repoRoot, 'instructions', 'COMMON.md'), 'utf8');
  const own = readFileSync(join(repoRoot, 'instructions', 'modules', spec.id, 'MODULE.md'), 'utf8');

  return `${banner(spec)}${common.trimEnd()}\n\n---\n\n${own.trimEnd()}\n`;
};

const skillPath = (spec: TModuleSpec): string =>
  join(repoRoot, '.claude', 'skills', skillName(spec), 'SKILL.md');

const run = (): number => {
  const check = process.argv.includes('--check');
  let stale = 0;

  for (const spec of modules) {
    const composed = compose(spec);
    const target = skillPath(spec);

    if (!check) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, composed, 'utf8');
      logger.info(
        `wrote .claude/skills/${skillName(spec)}/SKILL.md (${composed.split('\n').length} lines)`,
      );
      continue;
    }

    const current = readFileSync(target, 'utf8');

    if (current !== composed) {
      logger.error(`STALE: ${skillName(spec)}/SKILL.md — run yarn skill:generate`);
      stale += 1;
    }
  }

  if (check && stale === 0) {
    logger.info(`all ${modules.length} skill file(s) up to date`);
  }

  return stale === 0 ? 0 : 1;
};

process.exit(run());
