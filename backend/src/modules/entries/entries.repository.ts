import { and, asc, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { entries, entryItems, entryStatus, entryType } from '../../models/entries.model';

type DbOrTx = typeof db | Tx;

export function findEntryById(dbh: DbOrTx, id: string) {
  return dbh.select().from(entries).where(eq(entries.id, id)).then((r) => r[0]);
}

export function findItemsByEntryId(dbh: DbOrTx, entryId: string) {
  return dbh.select().from(entryItems).where(eq(entryItems.entryId, entryId)).orderBy(asc(entryItems.seq));
}

export type NewEntry = {
  ref: string;
  dealerId: string;
  entryType: (typeof entryType.enumValues)[number];
  entryDate: string;
  place: string;
  customerName: string | null;
  remarks: string | null;
  totalQty: number;
  gps: string | null;
  signature: string | null;
  coverToldAt: Date | null;
  submittedBy: string;
};

export async function insertEntry(tx: Tx, input: NewEntry) {
  const [row] = await tx.insert(entries).values(input).returning();
  return row!;
}

export type NewEntryItem = {
  entryId: string;
  seq: number;
  modelId: string;
  batteryCode: string;
  batteryCodeEntered: string;
  oldBatteryCode: string | null;
  oldBatteryCodeEntered: string | null;
  faultCode: string | null;
  remarks: string | null;
};

export async function insertEntryItem(tx: Tx, input: NewEntryItem) {
  const [row] = await tx.insert(entryItems).values(input).returning();
  return row!;
}

export async function updateEntryItemLinks(tx: Tx, id: string, links: { batteryId: string; oldBatteryId?: string; claimId?: string }) {
  const [row] = await tx.update(entryItems).set(links).where(eq(entryItems.id, id)).returning();
  return row!;
}

export async function updateEntryStatus(
  tx: Tx,
  id: string,
  input: { status: (typeof entryStatus.enumValues)[number]; decidedBy: string; decisionReason: string },
) {
  const [row] = await tx.update(entries).set({ ...input, decidedAt: new Date(), updatedAt: new Date() }).where(eq(entries.id, id)).returning();
  return row!;
}

export type EntryListFilter = { status?: (typeof entryStatus.enumValues)[number]; dealerId?: string; limit: number; cursor?: { createdAt: Date; id: string } };

export async function listEntries(dbh: DbOrTx, filter: EntryListFilter) {
  const conditions = [
    filter.status ? eq(entries.status, filter.status) : undefined,
    filter.dealerId ? eq(entries.dealerId, filter.dealerId) : undefined,
    filter.cursor
      ? or(lt(entries.createdAt, filter.cursor.createdAt), and(eq(entries.createdAt, filter.cursor.createdAt), lt(entries.id, filter.cursor.id)))
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await dbh
    .select()
    .from(entries)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(entries.createdAt), desc(entries.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const page = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null;
  // Items ride along (one extra query for the page) — the register, approvals and returns
  // screens all show the codes, so a per-entry fetch would be N+1 from the app.
  const allItems = page.length ? await dbh.select().from(entryItems).where(inArray(entryItems.entryId, page.map((e) => e.id))).orderBy(entryItems.seq) : [];
  const items = page.map((e) => ({ ...e, items: allItems.filter((i) => i.entryId === e.id) }));
  return { items, nextCursor };
}
