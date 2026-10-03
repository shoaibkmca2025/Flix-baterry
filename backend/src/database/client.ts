import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import * as governance from '../models/governance.model';
import * as masters from '../models/masters.model';
import * as identity from '../models/identity.model';
import * as batteriesModel from '../models/batteries.model';
import * as warrantyModel from '../models/warranty.model';
import * as claimsModel from '../models/claims.model';
import * as entriesModel from '../models/entries.model';
import * as returnsModel from '../models/returns.model';

const schema = { ...governance, ...masters, ...identity, ...batteriesModel, ...warrantyModel, ...claimsModel, ...entriesModel, ...returnsModel };

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
});

// node-postgres's own docs: an idle client in the pool can be dropped by the server at any
// time (Neon does this aggressively) and emits an 'error' event on the Pool with nothing
// listening — Node then treats it as an uncaught exception and kills the whole process.
// Without this handler, a single dropped idle connection crashes the entire API, not just
// the one request that needed it.
pool.on('error', (err) => {
  logger.error({ err }, 'idle Postgres client error (pool recovers automatically)');
});

// The handler above only covers IDLE clients: the pool takes its own listener off a client while
// a request is using it. If the server drops the connection mid-request (seen 3 Oct 2026, in the
// middle of a transaction), that client's 'error' event has no listener either and the process
// exits. With one attached, the query in flight rejects, that one request fails, and the pool
// discards the client — everything else keeps running.
pool.on('connect', (client) => {
  client.on('error', (err) => {
    logger.error({ err }, 'Postgres client error while in use (the request fails; the server keeps running)');
  });
});

export const db = drizzle(pool, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// rules.md §6 — one use-case = one transaction; every write goes through this.
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

export async function checkConnection(): Promise<boolean> {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    client?.release();
  }
}
