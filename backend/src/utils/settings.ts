import { eq } from 'drizzle-orm';
import type { db as Db, Tx } from '../database/client';
import { settings } from '../models/governance.model';
import { DEFAULT_GRACE_MONTHS } from '../domain/warranty';
import { DEFAULT_DIGIT_LENGTHS } from '../domain/serials';

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

/**
 * How many digits a battery's number may have (memory.md D-18). Felix's plants do not agree —
 * the main one prints 7 and 8 — and the other two are not confirmed yet, so this is a setting:
 * adding a plant's length is a row to change, not a release.
 */
export async function serialDigitLengths(dbh: DbOrTx): Promise<number[]> {
  const v = await readSetting<number[]>(dbh, 'serials.digit_lengths', [...DEFAULT_DIGIT_LENGTHS]);
  const clean = Array.isArray(v) ? v.filter((n) => Number.isInteger(n) && n > 4 && n <= 12) : [];
  return clean.length ? clean : [...DEFAULT_DIGIT_LENGTHS];
}
