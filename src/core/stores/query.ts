import { readFileSync } from 'node:fs';

/**
 * This repo never talks to a store. The MCP servers are reached through **connectors**, which
 * are authenticated at the Claude Code layer, so only the agent session can call them.
 *
 * The division of labour that follows from that:
 *   - the script decides WHICH queries to run and composes the exact SQL  (`yarn queries`)
 *   - the agent executes them through the db-mcp connector and saves the raw results
 *   - the script does every calculation on those results                  (`yarn detect`)
 *
 * The agent is a pipe for tool calls. It composes no SQL and computes nothing.
 */
export type TStore = 'starrocks' | 'mysqlProd' | 'mysqlDev';

/** The db-mcp tool each store is reached by. Named here so the plan can print it. */
export const toolFor = (store: TStore): string => {
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

/** One query for the agent to execute. `id` is how the result is handed back. */
export type TPlannedQuery = { id: string; store: TStore; tool: string; sql: string };

/** db-mcp returns this shape as a single text block. */
export type TQueryResult = {
  columns: Array<string>;
  rows: Array<Array<unknown>>;
  error?: string;
};

export type TResultsFile = Record<string, TQueryResult>;

export type TParams = Record<string, string | number | Array<string | number>>;

const quote = (value: string | number): string =>
  typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`;

/**
 * Binds `:name` placeholders. A list binds as a comma-separated literal because db-mcp takes
 * a SQL string, not a parameter array. Every value is an id or a date this pipeline computed.
 */
export const bindSql = (sql: string, params: TParams): string =>
  Object.entries(params).reduce((acc, [key, value]) => {
    const literal = Array.isArray(value) ? value.map(quote).join(', ') : quote(value);

    return acc.replace(new RegExp(`:${key}\\b`, 'g'), literal);
  }, sql);

export const loadSql = (path: string): string => readFileSync(path, 'utf8');

export const plannedQuery = (
  id: string,
  store: TStore,
  sqlPath: string,
  params: TParams = {},
): TPlannedQuery => ({ id, store, tool: toolFor(store), sql: bindSql(loadSql(sqlPath), params) });

/**
 * Decodes one saved result into row objects. A result carrying `error` stops the run — either
 * signal means stop, and reading past it produces work built on state that was never there.
 */
export const rowsOf = (results: TResultsFile, id: string): Array<TRow> => {
  const result = results[id];

  if (result === undefined) {
    throw new Error(`BLOCKED: results file has no entry for query "${id}"`);
  }

  if (result.error !== undefined) {
    throw new Error(`BLOCKED: query "${id}" returned an error: ${result.error}`);
  }

  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((column, index) => [column, row[index]])),
  );
};

export const num = (value: unknown): number => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

export const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

export const day = (value: unknown): string => str(value).slice(0, 10);
