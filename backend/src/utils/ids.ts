import { sql } from 'drizzle-orm';
import type { Tx } from '../database/client';
import { counters } from '../models/governance.model';

// architecture.md §9.1 — atomic, gap-free reference numbering. ON CONFLICT...DO UPDATE...
// RETURNING is one round trip and safe under concurrent callers; a rolled-back transaction
// leaves no gap because the UPDATE itself rolls back too.
export async function nextRef(tx: Tx, kind: string, period: string): Promise<number> {
  const [row] = await tx
    .insert(counters)
    .values({ kind, period, value: 1 })
    .onConflictDoUpdate({ target: [counters.kind, counters.period], set: { value: sql`${counters.value} + 1` } })
    .returning();
  return row!.value;
}

// 'CLM-26-09-0212' style — architecture.md §9.1 table.
export async function nextFormattedRef(tx: Tx, prefix: string, kind: string, monthKey: string): Promise<string> {
  const value = await nextRef(tx, kind, monthKey);
  return `${prefix}-${monthKey}-${String(value).padStart(4, '0')}`;
}

// 'YY-MM' from a Date, in the business timezone's calendar date (architecture.md §6.1 —
// business dates use TZ, not UTC; callers pass an already-Kolkata-correct Date).
export function monthKey(date: Date): string {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}
