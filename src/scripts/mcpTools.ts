import type { TServerName } from '../core/mcp/client';

import { closeAll, listTools } from '../core/mcp/client';
import { logger } from '../core/utils/logger';

/**
 * Lists what each configured MCP server actually exposes. Run this ONCE before the first live
 * run and pin the real names in `services/devrev/client.ts` and `services/slack/client.ts` —
 * a guessed tool name fails at 09:30 unattended, which is the worst time to learn it.
 */
const servers: Array<TServerName> = ['db-mcp', 'slack', 'devrev'];

const main = async (): Promise<void> => {
  for (const server of servers) {
    try {
      const tools = await listTools(server);

      logger.info(`${server} (${tools.length} tools):`);
      tools.forEach((t) => logger.info(`  ${t}`));
    } catch (error: unknown) {
      logger.warn(`${server}: unreachable — ${String(error)}`);
    }
  }
};

main()
  .then(closeAll)
  .catch(async (error: unknown) => {
    logger.error(`BLOCKED in mcp:tools: ${String(error)}`);
    await closeAll();
    process.exit(1);
  });
