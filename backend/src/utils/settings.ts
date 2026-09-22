import { eq } from 'drizzle-orm';
import type { db as Db, Tx } from '../database/client';
import { settings } from '../models/governance.model';
import { DEFAULT_GRACE_MONTHS } from '../domain/warranty';

type DbOrTx = typeof Db | Tx;

// Read-only access to the settings table (the settings module owns the writes — modules.md §4).
export async function readSetting<T>(dbh: DbOrTx, key: string, fallback: T): Promise<T> {
  const [row] = await dbh.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  return row ? (row.value as T) : fallback;
}

/** memory.md D-11 — months added to every model's term because a battery may sit between manufacture and sale. */
export async function graceMonths(dbh: DbOrTx): Promise<number> {
  const v = await readSetting<number>(dbh, 'warranty.grace_months', DEFAULT_GRACE_MONTHS);
  return Number.isInteger(v) && v >= 0 ? v : DEFAULT_GRACE_MONTHS;
}
