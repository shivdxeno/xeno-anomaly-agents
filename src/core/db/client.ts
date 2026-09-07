import { readFileSync } from 'node:fs';

import mysql from 'mysql2/promise';

/**
 * StarRocks speaks the MySQL wire protocol, so one driver reaches all three stores. They are
 * separate connections on purpose: metrics come from StarRocks, merchant names from PROD
 * MySQL, and the devrev_* mapping tables only exist on DEV MySQL.
 */
export type TStore = 'starrocks' | 'mysqlProd' | 'mysqlDev';

export type TRow = Record<string, unknown>;

const envFor = (
  store: TStore,
): { host: string; port: number; user: string; password: string; database: string } => {
  const prefix = { starrocks: 'STARROCKS', mysqlProd: 'MYSQL_PROD', mysqlDev: 'MYSQL_DEV' }[store];
  const need = (key: string): string => {
    const value = process.env[`${prefix}_${key}`];

    if (value === undefined || value === '') {
      throw new Error(`BLOCKED: ${prefix}_${key} is not set — see .env.example`);
    }

    return value;
  };

  return {
    host: need('HOST'),
    port: Number(need('PORT')),
    user: need('USER'),
    password: need('PASSWORD'),
    database: need('DATABASE'),
  };
};

const pools = new Map<TStore, mysql.Pool>();

const poolFor = (store: TStore): mysql.Pool => {
  const existing = pools.get(store);

  if (existing !== undefined) {
    return existing;
  }

  const created = mysql.createPool({ ...envFor(store), connectionLimit: 2, dateStrings: true });

  pools.set(store, created);

  return created;
};

export const closeAll = async (): Promise<void> => {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
};

export type TParams = Record<string, string | number | Array<string | number>>;

/**
 * Binds `:name` placeholders. A list binds as a comma-separated literal because `IN (?)` with
 * an array is not portable across these three servers. Values go through the driver's escape,
 * so this is not string concatenation of untrusted input — but every caller here passes ids
 * and dates the pipeline computed, never anything a person typed.
 */
export const bindSql = (sql: string, params: TParams): string =>
  Object.entries(params).reduce((acc, [key, value]) => {
    const literal = Array.isArray(value)
      ? value.map((v) => mysql.escape(v)).join(', ')
      : mysql.escape(value);

    return acc.replace(new RegExp(`:${key}\\b`, 'g'), literal);
  }, sql);

export const loadSql = (path: string): string => readFileSync(path, 'utf8');

/** Three attempts, then give up. A structural failure fails identically every time. */
export const query = async (
  store: TStore,
  sql: string,
  params: TParams = {},
  attempts = 3,
): Promise<Array<TRow>> => {
  const bound = bindSql(sql, params);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const [rows] = await poolFor(store).query(bound);

      return rows as Array<TRow>;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`query failed after ${attempts} attempts on ${store}: ${String(lastError)}`);
};

export const num = (value: unknown): number => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

export const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

/** StarRocks returns dates as strings with dateStrings:true; keep only the calendar day. */
export const day = (value: unknown): string => str(value).slice(0, 10);
