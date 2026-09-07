import { readFileSync, writeFileSync } from 'node:fs';

import type { TFindingsFile } from '../core/pipeline/detect';
import type { TRenderContext } from '../core/services/render';

import { moduleById } from '../core/modules/registry';
import { renderJourneyMessage, renderMerchantMessage } from '../core/services/render';
import { parseArgs, requireArg } from '../core/utils/args';
import { logger } from '../core/utils/logger';

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));
  const inPath = typeof args.in === 'string' ? args.in : 'findings.json';
  const out = typeof args.out === 'string' ? args.out : 'messages.json';
  const findings = JSON.parse(readFileSync(inPath, 'utf8')) as TFindingsFile;
  const spec = moduleById(findings.module);
  const caveatArg = typeof args.caveat === 'string' ? [args.caveat] : [];
  // Ticket ids come from tickets:apply, which runs BEFORE this stage so the id can print.
  const applied =
    typeof args.tickets === 'string'
      ? (JSON.parse(readFileSync(args.tickets, 'utf8')) as Record<string, { ticketId: string }>)
      : {};
  const withTickets = (rows: TFindingsFile['merchants']): TFindingsFile['merchants'] =>
    rows.map((f) => {
      const hit = applied[f.incidentKey];

      return hit === undefined ? f : { ...f, ticketId: hit.ticketId };
    });
  const ctx: TRenderContext = {
    spec,
    window: findings.window,
    tokensK: typeof args.tokens === 'string' ? Number(args.tokens) : null,
    runDate: findings.runDate,
    caveats: [...findings.caveats, ...caveatArg],
  };
  const messages = [
    renderMerchantMessage(withTickets(findings.merchants), ctx),
    renderJourneyMessage(withTickets(findings.journeys), ctx),
  ];

  writeFileSync(
    out,
    `${JSON.stringify({ channel: requireArg(args, 'channel'), messages }, null, 2)}\n`,
  );
  logger.info(`render: 2 messages -> ${out}`);
};

try {
  main();
} catch (error: unknown) {
  logger.error(`BLOCKED in render: ${String(error)}`);
  process.exit(1);
}
