import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../config/env';
import * as governance from '../models/governance.model';
import * as masters from '../models/masters.model';
import * as identity from '../models/identity.model';

const schema = { ...governance, ...masters, ...identity };

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
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
