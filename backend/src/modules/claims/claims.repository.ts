import { and, desc, eq, lt, or } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { claimStatus, creditNotes, warrantyClaims } from '../../models/claims.model';

type DbOrTx = typeof db | Tx;

export function findClaimById(dbh: DbOrTx, id: string) {
  return dbh.select().from(warrantyClaims).where(eq(warrantyClaims.id, id)).then((r) => r[0]);
}

export type NewClaim = { ref: string; dealerId: string; chainId: string; oldBatteryId: string; newBatteryId: string };

export async function insertClaim(tx: Tx, input: NewClaim) {
  const [row] = await tx.insert(warrantyClaims).values(input).returning();
  return row!;
}

export async function updateClaimStatus(tx: Tx, id: string, status: (typeof claimStatus.enumValues)[number]) {
  const [row] = await tx.update(warrantyClaims).set({ status, updatedAt: new Date() }).where(eq(warrantyClaims.id, id)).returning();
  return row!;
}

export type ClaimCheckUpdate = {
  status: (typeof claimStatus.enumValues)[number];
  findingCode: string;
  conditionNote: string | null;
  disposition: 'repair' | 'scrap' | 'hold';
  decidedBy?: string;
  decisionReason?: string;
  decidedAt?: Date;
};

export async function updateClaimCheck(tx: Tx, id: string, input: ClaimCheckUpdate) {
  const [row] = await tx.update(warrantyClaims).set({ ...input, updatedAt: new Date() }).where(eq(warrantyClaims.id, id)).returning();
  return row!;
}

export async function updateClaimDecision(
  tx: Tx,
  id: string,
  input: { status: 'approved' | 'refused'; decidedBy: string; decisionReason: string; creditNoteId?: string },
) {
  const [row] = await tx.update(warrantyClaims).set({ ...input, decidedAt: new Date(), updatedAt: new Date() }).where(eq(warrantyClaims.id, id)).returning();
  return row!;
}

export async function insertCreditNote(tx: Tx, input: { no: string; dealerId: string; claimId: string; amount: number; issuedBy: string }) {
  const [row] = await tx.insert(creditNotes).values(input).returning();
  return row!;
}

export type ClaimListFilter = { status?: (typeof claimStatus.enumValues)[number]; dealerId?: string; limit: number; cursor?: { createdAt: Date; id: string } };

export async function listClaims(dbh: DbOrTx, filter: ClaimListFilter) {
  const conditions = [
    filter.status ? eq(warrantyClaims.status, filter.status) : undefined,
    filter.dealerId ? eq(warrantyClaims.dealerId, filter.dealerId) : undefined,
    filter.cursor
      ? or(lt(warrantyClaims.createdAt, filter.cursor.createdAt), and(eq(warrantyClaims.createdAt, filter.cursor.createdAt), lt(warrantyClaims.id, filter.cursor.id)))
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await dbh
    .select()
    .from(warrantyClaims)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(warrantyClaims.createdAt), desc(warrantyClaims.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null;
  return { items, nextCursor };
}
