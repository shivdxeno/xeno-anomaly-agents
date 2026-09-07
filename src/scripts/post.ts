import { readFileSync } from 'node:fs';

import { postMessage } from '../core/services/slack/client';
import { parseArgs } from '../core/utils/args';
import { logger } from '../core/utils/logger';

/** Two messages, and only two. */
const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const inPath = typeof args.in === 'string' ? args.in : 'messages.json';
  const payload = JSON.parse(readFileSync(inPath, 'utf8')) as {
    channel: string;
    messages: Array<string>;
  };

  if (args['dry-run'] === true) {
    payload.messages.forEach((m, i) => logger.info(`--- message ${i + 1} ---\n${m}`));

    return;
  }

  for (const [index, message] of payload.messages.entries()) {
    const posted = await postMessage(payload.channel, message);

    logger.info(`posted message ${index + 1} of ${payload.messages.length}: ${posted.permalink}`);
  }
};

main().catch((error: unknown) => {
  logger.error(`BLOCKED in post: ${String(error)}`);
  process.exit(1);
});
