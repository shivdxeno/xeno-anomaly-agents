import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TFindingsFile } from '../core/pipeline/detect';

import { closeAll } from '../core/mcp/client';
import { moduleById } from '../core/modules/registry';
import { planTickets } from '../core/pipeline/tickets';
import { loadSql, num, query, str } from '../core/stores/query';
import { parseArgs } from '../core/utils/args';
import { logger } from '../core/utils/logger';

/**
 * The DevRev field resolution runs against DEV MySQL — none of the devrev_* tables exist in
 * prod. It is one query for the whole run, over the merchants that actually reach a ticket.
 */
const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const inPath = typeof args.in === 'string' ? args.in : 'findings.json';
  const out = typeof args.out === 'string' ? args.out : 'plan.json';
  const findings = JSON.parse(readFileSync(inPath, 'utf8')) as TFindingsFile;
  const spec = moduleById(findings.module);
  const merchantIds = [
    ...new Set([...findings.merchants, ...findings.journeys].map((f) => f.merchantId)),
  ];
  const resolution = new Map<number, { accountDon: string | null; revOrgDon: string | null }>();
  let ownerDon: string | null = null;

  if (merchantIds.length > 0) {
    const sql = loadSql(
      join(__dirname, '..', 'modules', spec.id, 'queries', '04b_devrev_fields.sql'),
    );
    const rows = await query('mysqlDev', sql, {
      merchant_id_rows: merchantIds.map((id) => `SELECT ${id} AS id`).join(' UNION '),
      product_module_lower: spec.productModule.toLowerCase(),
    });

    for (const row of rows) {
      if (str(row.kind) === 'owner') {
        ownerDon = str(row.account_name) === '' ? null : str(row.account_name);
        continue;
      }

      resolution.set(num(row.key_col), {
        accountDon: str(row.account_don) === '' ? null : str(row.account_don),
        revOrgDon: str(row.rev_org_don) === '' ? null : str(row.rev_org_don),
      });
    }
  }

  const missing = merchantIds.filter((id) => (resolution.get(id)?.accountDon ?? null) === null);
  const plan = planTickets(findings, spec, resolution, ownerDon);

  writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  logger.info(
    `tickets:plan: ${plan.planned.length} planned, ${plan.suppressedByCap} suppressed by cap -> ${out}`,
  );

  if (missing.length > 0) {
    logger.warn(
      `no DevRev account mapping for merchants: ${missing.join(', ')} — filing without account`,
    );
  }
};

main()
  .then(closeAll)
  .catch(async (error: unknown) => {
    logger.error(`BLOCKED in tickets:plan: ${String(error)}`);
    await closeAll();
    process.exit(1);
  });
