import { and, asc, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { challanLines, challans } from '../../models/returns.model';

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

export async function updateLineStage(tx: Tx, id: string, values: Pick<NewLine, 'stage' | 'stageNote' | 'stagedBy' | 'stagedAt' | 'shortage'>) {
  const [row] = await tx.update(challanLines).set(values).where(eq(challanLines.id, id)).returning();
  return row;
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
