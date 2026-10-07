import { and, asc, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { coverCaseEnum, entries, entryItems, entryStatus, entryType } from '../../models/entries.model';
import { entryPhotos } from '../../models/evidence.model';

type DbOrTx = typeof db | Tx;

export function findEntryById(dbh: DbOrTx, id: string) {
  return dbh.select().from(entries).where(eq(entries.id, id)).then((r) => r[0]);
}

export function findEntriesByIds(dbh: DbOrTx, ids: string[]) {
  if (!ids.length) return Promise.resolve([] as (typeof entries.$inferSelect)[]);
  return dbh.select().from(entries).where(inArray(entries.id, ids));
}

export function findItemsByEntryId(dbh: DbOrTx, entryId: string) {
  return dbh.select().from(entryItems).where(eq(entryItems.entryId, entryId)).orderBy(asc(entryItems.seq));
}

// One query for a whole page of entries (list endpoint), instead of one per entry.
export function findItemsByEntryIds(dbh: DbOrTx, entryIds: string[]) {
  if (!entryIds.length) return Promise.resolve([] as Awaited<ReturnType<typeof findItemsByEntryId>>);
  return dbh.select().from(entryItems).where(inArray(entryItems.entryId, entryIds)).orderBy(asc(entryItems.entryId), asc(entryItems.seq));
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
  status?: (typeof entryStatus.enumValues)[number]; // a dealer's request starts with_distributor
  returnKind?: 'unsold' | 'defective' | null; // sales returns only
  byAdmin?: boolean; // recorded by head office, not sent in by a shop
  specialStatus?: 'pending' | null; // a battery on it is past its term — head office decides it in Correction requests
};

export async function insertEntry(tx: Tx, input: NewEntry) {
  const [row] = await tx.insert(entries).values(input).returning();
  return row!;
}

export type NewEntryItem = {
  entryId: string;
  seq: number;
  modelId: string;
  // null only on a request head office recorded before the new battery's number was known
  batteryCode: string | null;
  batteryCodeEntered: string | null;
  oldBatteryCode: string | null;
  oldBatteryCodeEntered: string | null;
  oldModelId?: string | null;
  faultCode: string | null;
  remarks: string | null;
  // the old battery's cover as judged when the request was made (null = within the term)
  coverCase?: (typeof coverCaseEnum.enumValues)[number] | null;
  coverTermEnd?: string | null;
  coverEnd?: string | null;
};

export async function insertEntryItem(tx: Tx, input: NewEntryItem) {
  const [row] = await tx.insert(entryItems).values(input).returning();
  return row!;
}

export async function updateEntryItemLinks(tx: Tx, id: string, links: { batteryId: string; oldBatteryId?: string; claimId?: string }) {
  const [row] = await tx.update(entryItems).set(links).where(eq(entryItems.id, id)).returning();
  return row!;
}

export function findItemById(dbh: DbOrTx, id: string) {
  return dbh.select().from(entryItems).where(eq(entryItems.id, id)).then((r) => r[0]);
}

/** One battery on a request: marked as being looked at, or its serials rewritten. */
export async function updateEntryItem(tx: Tx, id: string, set: Partial<typeof entryItems.$inferInsert>) {
  const [row] = await tx.update(entryItems).set(set).where(eq(entryItems.id, id)).returning();
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

/** Takes a request out of every live queue. Guarded on the status it was read in, so a decision taken a moment earlier is not overwritten. */
export async function setVoid(tx: Tx, id: string, input: { from: (typeof entryStatus.enumValues)[number]; by: string; reason: string }) {
  const now = new Date();
  const [row] = await tx
    .update(entries)
    .set({ status: 'void', voidedBy: input.by, voidedAt: now, voidReason: input.reason, updatedAt: now })
    .where(and(eq(entries.id, id), eq(entries.status, input.from)))
    .returning();
  return row;
}

/** The distributor approves (→ submitted, head office's queue) or refuses (→ rejected) a dealer's request. */
export async function setDistributorDecision(tx: Tx, id: string, input: { approve: boolean; by: string; reason: string }) {
  const now = new Date();
  const [row] = await tx
    .update(entries)
    .set({
      status: input.approve ? 'submitted' : 'rejected',
      distributorDecidedBy: input.by, distributorDecidedAt: now, distributorReason: input.reason,
      // a refusal is the request's decision too — the dealer reads it like head office's
      ...(input.approve ? {} : { decidedBy: input.by, decidedAt: now, decisionReason: input.reason }),
      updatedAt: now,
    })
    .where(and(eq(entries.id, id), eq(entries.status, 'with_distributor')))
    .returning();
  return row;
}

/**
 * Head office's decision on a SPECIAL request (client, 3 Oct 2026), or its end when the
 * distributor refuses it. Approving only opens the way — the request itself is still decided at
 * the factory; rejecting ends the request with the reason.
 */
export async function setSpecialDecision(tx: Tx, id: string, input: { approve: boolean; by: string; reason: string }) {
  const now = new Date();
  const [row] = await tx
    .update(entries)
    .set({
      specialStatus: input.approve ? 'approved' : 'rejected',
      specialDecidedBy: input.by, specialDecidedAt: now, specialReason: input.reason,
      ...(input.approve ? {} : { status: 'rejected' as const, decidedBy: input.by, decidedAt: now, decisionReason: input.reason }),
      updatedAt: now,
    })
    .where(and(eq(entries.id, id), eq(entries.specialStatus, 'pending')))
    .returning();
  return row;
}

// `dealerIds`: a distributor reads his own requests and his dealers'
export type EntryListFilter = { status?: (typeof entryStatus.enumValues)[number]; dealerId?: string; dealerIds?: string[]; limit: number; cursor?: { createdAt: Date; id: string } };

export async function listEntries(dbh: DbOrTx, filter: EntryListFilter) {
  const conditions = [
    filter.status ? eq(entries.status, filter.status) : undefined,
    filter.dealerId ? eq(entries.dealerId, filter.dealerId) : undefined,
    filter.dealerIds ? inArray(entries.dealerId, filter.dealerIds.length ? filter.dealerIds : ['00000000-0000-0000-0000-000000000000']) : undefined,
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

/* ---------- photos the dealer attached (entry_photos, D-10) ---------- */

export type NewPhoto = typeof entryPhotos.$inferInsert;

/** One photo per tile: the same request + battery + tag again replaces the earlier one. */
export function upsertPhoto(dbh: DbOrTx, row: NewPhoto) {
  return dbh
    .insert(entryPhotos)
    .values(row)
    .onConflictDoUpdate({
      target: [entryPhotos.entryId, entryPhotos.entryItemId, entryPhotos.tag],
      set: { objectKey: row.objectKey, contentType: row.contentType, sizeBytes: row.sizeBytes, uploadedBy: row.uploadedBy, createdAt: new Date() },
    })
    .returning()
    .then((r) => r[0]!);
}

export function findPhotosByEntryId(dbh: DbOrTx, entryId: string) {
  return dbh.select().from(entryPhotos).where(eq(entryPhotos.entryId, entryId)).orderBy(asc(entryPhotos.createdAt));
}
