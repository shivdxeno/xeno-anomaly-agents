import { readFileSync, writeFileSync } from 'node:fs';

import type { TTicketPlan } from '../core/pipeline/tickets';

import { addInternalComment, createTicket } from '../core/services/devrev/client';
import { parseArgs } from '../core/utils/args';
import { logger } from '../core/utils/logger';

/**
 * The ONLY stage that writes to DevRev. A failed ticket never blocks the post: the report is
 * the deliverable, and a morning with a good report and no tickets is a working run with a
 * broken integration.
 */
const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const inPath = typeof args.in === 'string' ? args.in : 'plan.json';
  const dryRun = args['dry-run'] === true;
  const outPath = typeof args.out === 'string' ? args.out : 'applied.json';
  const plan = JSON.parse(readFileSync(inPath, 'utf8')) as TTicketPlan;
  const failures: Array<string> = [];
  // The ticket id goes back into the report, so what was created is written out even on a
  // partial failure — the report is the deliverable and must not wait on a clean ticket run.
  const applied: Record<string, { ticketId: string }> = {};

  for (const item of plan.planned) {
    if (dryRun) {
      logger.info(`[dry-run] ${item.action} ${item.incidentKey}: ${item.title}`);
      continue;
    }

    try {
      if (item.action === 'create') {
        const created = await createTicket({
          title: item.title,
          body: item.body,
          severity: item.severity,
          productModule: item.productModule,
          accountDon: item.accountDon,
          revOrgDon: item.revOrgDon,
          ownerDon: item.ownerDon,
        });

        // The detail comment is part of creating, not a follow-up: the journey list exists
        // nowhere else. Retry once, then report which ids are missing their detail.
        await addInternalComment(created.id, item.comment).catch(() =>
          addInternalComment(created.id, item.comment),
        );
        applied[item.incidentKey] = { ticketId: created.displayId };
        logger.info(`created ${created.displayId} for ${item.incidentKey}`);
        continue;
      }

      if (item.existingTicketId !== null) {
        await addInternalComment(item.existingTicketId, item.comment);
        applied[item.incidentKey] = { ticketId: item.existingTicketId };
        logger.info(`commented on ${item.existingTicketId} for ${item.incidentKey}`);
      }
    } catch (error: unknown) {
      failures.push(`${item.incidentKey}: ${String(error)}`);
    }
  }

  writeFileSync(outPath, `${JSON.stringify(applied, null, 2)}\n`, 'utf8');

  if (failures.length > 0) {
    logger.warn(`${failures.length} of ${plan.planned.length} ticket calls failed:`);
    failures.forEach((f) => logger.warn(`  ${f}`));
  }
};

main().catch((error: unknown) => {
  logger.error(`BLOCKED in tickets:apply: ${String(error)}`);
  process.exit(1);
});
