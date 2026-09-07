import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { logger } from '../utils/logger';

/**
 * Every external system is reached through its MCP server — never through a database driver
 * or a hand-rolled HTTP call. That is deliberate: the servers already hold the credentials,
 * the read-only scopes, the per-user grants and the audit trail. Re-implementing access here
 * would duplicate all four and put DB passwords in this repo's environment.
 *
 * Server URLs come from `.mcp.json`, the same file Claude Code reads, so there is one place
 * that says where these servers live.
 */
export type TServerName = 'db-mcp' | 'slack' | 'devrev';

type TServerConfig = { type: string; url: string };

const expandEnv = (value: string): string =>
  value.replace(/\$\{env:([A-Z0-9_]+)\}/g, (_, key: string) => process.env[key] ?? '');

const readConfig = (): Record<string, TServerConfig> => {
  const path = join(__dirname, '..', '..', '..', '.mcp.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    mcpServers: Record<string, TServerConfig>;
  };

  return parsed.mcpServers;
};

/**
 * Bearer token per server, when the server wants one. A headless run cannot complete an
 * interactive OAuth flow, so the token is supplied as `<SERVER>_MCP_TOKEN` — see
 * `.env.example`. A server that needs auth and has none fails loudly on the first call
 * rather than returning an empty result.
 */
const tokenEnvFor = (name: TServerName): string =>
  `${name.replace(/-mcp$/, '').replace(/-/g, '_').toUpperCase()}_MCP_TOKEN`;

const clients = new Map<TServerName, Client>();

const connect = async (name: TServerName): Promise<Client> => {
  const existing = clients.get(name);

  if (existing !== undefined) {
    return existing;
  }

  const config = readConfig()[name];

  if (config === undefined) {
    throw new Error(`BLOCKED: no "${name}" server in .mcp.json`);
  }

  const url = expandEnv(config.url);

  if (url === '') {
    throw new Error(`BLOCKED: the URL for "${name}" resolved to empty — check .mcp.json and .env`);
  }

  const token = process.env[tokenEnvFor(name)];
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit:
      token === undefined || token === ''
        ? undefined
        : { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'xeno-anomaly-agents', version: '1.0.0' });

  await client.connect(transport);
  clients.set(name, client);

  return client;
};

export const closeAll = async (): Promise<void> => {
  await Promise.all([...clients.values()].map((c) => c.close()));
  clients.clear();
};

export const listTools = async (name: TServerName): Promise<Array<string>> => {
  const client = await connect(name);
  const result = await client.listTools();

  return result.tools.map((t) => t.name);
};

const textOf = (content: unknown): string => {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((b): b is { type: string; text: string } => (b as { type?: string }).type === 'text')
    .map((b) => b.text)
    .join('\n');
};

/**
 * One tool call, up to three attempts. A structural failure fails identically every time, so
 * the retry only ever recovers a transient one — see the transient/structural split the
 * detection prompt already drew.
 */
export const callTool = async (
  server: TServerName,
  tool: string,
  args: Record<string, unknown>,
  attempts = 3,
): Promise<string> => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const client = await connect(server);
      const result = await client.callTool({ name: tool, arguments: args });

      if (result.isError === true) {
        throw new Error(textOf(result.content));
      }

      return textOf(result.content);
    } catch (error: unknown) {
      lastError = error;

      if (attempt < attempts) {
        logger.warn(`${server}/${tool} attempt ${attempt} failed, retrying`);
      }
    }
  }

  throw new Error(`${server}/${tool} failed after ${attempts} attempts: ${String(lastError)}`);
};
