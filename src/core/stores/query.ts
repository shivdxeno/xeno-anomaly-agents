import { readFileSync } from 'node:fs';

import { callTool } from '../mcp/client';

/**
 * Which db-mcp tool each store is reached by. All three go through the same MCP server, which
 * is what keeps the read-only scope and the grant audit in one place.
 */
export type TStore = 'starrocks' | 'mysqlProd' | 'mysqlDev';

const toolFor = (store: TStore): string => {
  switch (store) {
    case 'starrocks':
      return 'query_starrocks';
    case 'mysqlProd':
      return 'query_mysql';
    default:
      return 'query_mysql_dev';
  }
};

export type TRow = Record<string, unknown>;

/** db-mcp returns one text block holding this shape. */
type TQueryPayload = {
  columns: Array<string>;
  rows: Array<Array<unknown>>;
  row_count?: number;
  duration_ms?: number;
  error?: string;
};

export type TParams = Record<string, string | number | Array<string | number>>;

const quote = (value: string | number): string =>
  typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`;

/**
 * Binds `:name` placeholders. A list binds as a comma-separated literal because these servers
 * take a SQL string, not a parameter array. Every value here is an id or a date this pipeline
 * computed — nothing a person typed reaches it.
 */
export const bindSql = (sql: string, params: TParams): string =>
  Object.entries(params).reduce((acc, [key, value]) => {
    const literal = Array.isArray(value) ? value.map(quote).join(', ') : quote(value);

    return acc.replace(new RegExp(`:${key}\\b`, 'g'), literal);
  }, sql);

export const loadSql = (path: string): string => readFileSync(path, 'utf8');

export const query = async (
  store: TStore,
  sql: string,
  params: TParams = {},
): Promise<Array<TRow>> => {
  const text = await callTool('db-mcp', toolFor(store), { sql: bindSql(sql, params) });
  let payload: TQueryPayload;

  try {
    payload = JSON.parse(text) as TQueryPayload;
  } catch {
    throw new Error(`db-mcp ${toolFor(store)} returned unparseable output: ${text.slice(0, 300)}`);
  }

  // A non-zero exit and an "error" body mean the same thing: stop, do not read past it.
  if (payload.error !== undefined) {
    throw new Error(`db-mcp ${toolFor(store)}: ${payload.error}`);
  }

  return payload.rows.map((row) =>
    Object.fromEntries(payload.columns.map((column, index) => [column, row[index]])),
  );
};

export const num = (value: unknown): number => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

export const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

export const day = (value: unknown): string => str(value).slice(0, 10);
