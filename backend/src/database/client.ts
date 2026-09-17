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

const schema = { ...governance, ...masters, ...identity, ...batteriesModel, ...warrantyModel, ...claimsModel };

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
