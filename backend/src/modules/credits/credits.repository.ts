import { and, desc, eq, gte, lt, or, sql } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { creditNoteStatus, creditNotes } from '../../models/credits.model';

type DbOrTx = typeof db | Tx;
export type CreditNoteStatus = (typeof creditNoteStatus.enumValues)[number];

export function findCreditNoteById(dbh: DbOrTx, id: string) {
  return dbh.select().from(creditNotes).where(eq(creditNotes.id, id)).then((r) => r[0]);
}

export function findCreditNoteByNo(dbh: DbOrTx, no: string) {
  return dbh.select().from(creditNotes).where(eq(creditNotes.no, no)).then((r) => r[0]);
}

export async function insertCreditNote(tx: Tx, input: { no: string; dealerId: string; claimId: string; amount: number; issuedBy: string; issuedAt: Date }) {
  const [row] = await tx.insert(creditNotes).values(input).returning();
  return row!;
}

export async function updateCreditNoteSettled(tx: Tx, id: string, input: { settledRef: string; adjustedBy: string; at: Date }) {
  const [row] = await tx
    .update(creditNotes)
    .set({ status: 'settled', settledRef: input.settledRef, settledAt: input.at, adjustedBy: input.adjustedBy, updatedAt: input.at })
    .where(eq(creditNotes.id, id))
    .returning();
  return row!;
}

export async function updateCreditNoteReversed(tx: Tx, id: string, input: { reason: string; adjustedBy: string; at: Date }) {
  const [row] = await tx
    .update(creditNotes)
    .set({ status: 'reversed', reversedReason: input.reason, reversedAt: input.at, adjustedBy: input.adjustedBy, updatedAt: input.at })
    .where(eq(creditNotes.id, id))
    .returning();
  return row!;
}

export type CreditNoteListFilter = { status?: CreditNoteStatus; dealerId?: string; limit: number; cursor?: { issuedAt: Date; id: string } };

// Newest-issued first; keyset cursor on (issued_at, id) — same shape as claims.listClaims.
export async function listCreditNotes(dbh: DbOrTx, filter: CreditNoteListFilter) {
  const conditions = [
    filter.status ? eq(creditNotes.status, filter.status) : undefined,
    filter.dealerId ? eq(creditNotes.dealerId, filter.dealerId) : undefined,
    filter.cursor
      ? or(lt(creditNotes.issuedAt, filter.cursor.issuedAt), and(eq(creditNotes.issuedAt, filter.cursor.issuedAt), lt(creditNotes.id, filter.cursor.id)))
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await dbh
    .select()
    .from(creditNotes)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(creditNotes.issuedAt), desc(creditNotes.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ issuedAt: last.issuedAt.toISOString(), id: last.id })).toString('base64url') : null;
  return { items, nextCursor };
}

// Totals a dealer's "Credit notes" screen (d37) shows: reversed notes never count as credit.
export async function sumCreditedForDealer(dbh: DbOrTx, dealerId: string, since?: Date) {
  const conditions = [eq(creditNotes.dealerId, dealerId), sql`${creditNotes.status} <> 'reversed'`, since ? gte(creditNotes.issuedAt, since) : undefined].filter(
    (c): c is NonNullable<typeof c> => c !== undefined,
  );
  const [row] = await dbh
    .select({ total: sql<number>`coalesce(sum(${creditNotes.amount}), 0)::int`, count: sql<number>`count(*)::int` })
    .from(creditNotes)
    .where(and(...conditions));
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
}
