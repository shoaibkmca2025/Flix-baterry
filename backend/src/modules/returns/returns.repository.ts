import { and, asc, desc, eq, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { challanLines, challans } from '../../models/returns.model';
import { entryItems } from '../../models/entries.model';
import { warrantyClaims } from '../../models/claims.model';

type DbOrTx = typeof db | Tx;

export function findChallanById(dbh: DbOrTx, id: string) {
  return dbh.select().from(challans).where(eq(challans.id, id)).then((r) => r[0] ?? null);
}

export function findLinesByChallanId(dbh: DbOrTx, challanId: string) {
  return dbh.select().from(challanLines).where(eq(challanLines.challanId, challanId)).orderBy(asc(challanLines.batteryCode));
}

export function findLinesByChallanIds(dbh: DbOrTx, ids: string[]) {
  if (!ids.length) return Promise.resolve([] as Awaited<ReturnType<typeof findLinesByChallanId>>);
  return dbh.select().from(challanLines).where(inArray(challanLines.challanId, ids)).orderBy(asc(challanLines.challanId), asc(challanLines.batteryCode));
}

export function findLineById(dbh: DbOrTx, id: string) {
  return dbh.select().from(challanLines).where(eq(challanLines.id, id)).then((r) => r[0] ?? null);
}

/** Entry items already on any challan — an old battery only travels back once. */
export function findLinesByEntryItemIds(dbh: DbOrTx, entryItemIds: string[]) {
  if (!entryItemIds.length) return Promise.resolve([] as Awaited<ReturnType<typeof findLinesByChallanId>>);
  return dbh.select().from(challanLines).where(inArray(challanLines.entryItemId, entryItemIds));
}

/**
 * What head office decided about each returned battery, read through the entry item the line
 * points at. A challan is the unit the dealer and the factory both think in — "10 went, 7 came
 * back approved" — but the decision lives on the claim, two hops away (client, 2 Oct 2026).
 */
export async function findClaimStateByEntryItemIds(dbh: DbOrTx, entryItemIds: string[]) {
  if (!entryItemIds.length) return [];
  return dbh
    .select({
      entryItemId: entryItems.id,
      claimId: warrantyClaims.id,
      status: warrantyClaims.status,
      decisionReason: warrantyClaims.decisionReason,
      conditionNote: warrantyClaims.conditionNote,
      creditNoteId: warrantyClaims.creditNoteId,
    })
    .from(entryItems)
    .leftJoin(warrantyClaims, eq(warrantyClaims.id, entryItems.claimId))
    .where(inArray(entryItems.id, entryItemIds));
}

export type NewChallan = typeof challans.$inferInsert;
export type NewLine = typeof challanLines.$inferInsert;

export async function insertChallan(tx: Tx, values: NewChallan) {
  const [row] = await tx.insert(challans).values(values).returning();
  return row;
}

export async function insertLines(tx: Tx, values: NewLine[]) {
  if (!values.length) return [];
  return tx.insert(challanLines).values(values).returning();
}

export async function markReceived(tx: Tx, id: string, by: string, at: Date) {
  const [row] = await tx.update(challans).set({ status: 'received', receivedBy: by, receivedAt: at, updatedAt: at }).where(eq(challans.id, id)).returning();
  return row;
}

export async function updateLineStage(tx: Tx, id: string, values: Pick<NewLine, 'stage' | 'stageNote' | 'stagedBy' | 'stagedAt' | 'shortage'> & { plantId?: string }) {
  const [row] = await tx.update(challanLines).set(values).where(eq(challanLines.id, id)).returning();
  return row;
}

export async function setLinePlant(tx: Tx, id: string, plantId: string) {
  const [row] = await tx.update(challanLines).set({ plantId }).where(eq(challanLines.id, id)).returning();
  return row;
}

export type LineListFilter = {
  plantId?: string | 'none';
  stage?: NewLine['stage'];
  dealerId?: string;
  limit: number;
  cursor?: { createdAt: Date; id: string };
};

/** Returned batteries across challans, newest challan first — the "by plant" view (D-19). */
export async function listLines(dbh: DbOrTx, filter: LineListFilter) {
  const conditions = [
    // "none" = arrived, but nobody has said which plant made it yet
    filter.plantId === 'none' ? and(isNull(challanLines.plantId), ne(challanLines.stage, 'in_transit')) : undefined,
    filter.plantId && filter.plantId !== 'none' ? eq(challanLines.plantId, filter.plantId) : undefined,
    filter.stage ? eq(challanLines.stage, filter.stage) : undefined,
    filter.dealerId ? eq(challans.dealerId, filter.dealerId) : undefined,
    filter.cursor
      ? or(lt(challans.createdAt, filter.cursor.createdAt), and(eq(challans.createdAt, filter.cursor.createdAt), lt(challanLines.id, filter.cursor.id)))
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await dbh
    .select({ line: challanLines, challanNo: challans.no, dealerId: challans.dealerId, challanCreatedAt: challans.createdAt })
    .from(challanLines)
    .innerJoin(challans, eq(challans.id, challanLines.challanId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(challans.createdAt), desc(challanLines.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const page = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.challanCreatedAt.toISOString(), id: last.line.id })).toString('base64url') : null;
  return { items: page.map((r) => ({ ...r.line, challanNo: r.challanNo, dealerId: r.dealerId })), nextCursor };
}

export type ChallanListFilter = { status?: 'dispatched' | 'received'; dealerId?: string; limit: number; cursor?: { createdAt: Date; id: string } };

export async function listChallans(dbh: DbOrTx, filter: ChallanListFilter) {
  const conditions = [
    filter.status ? eq(challans.status, filter.status) : undefined,
    filter.dealerId ? eq(challans.dealerId, filter.dealerId) : undefined,
    filter.cursor
      ? or(lt(challans.createdAt, filter.cursor.createdAt), and(eq(challans.createdAt, filter.cursor.createdAt), lt(challans.id, filter.cursor.id)))
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await dbh
    .select()
    .from(challans)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(challans.createdAt), desc(challans.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null;
  return { items, nextCursor };
}
