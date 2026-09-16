import { and, desc, eq, lt, or } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { dealers, dealerStatus, users } from '../../models/identity.model';

type DbOrTx = typeof db | Tx;

export function findDealerByMobile(dbh: DbOrTx, mobile: string) {
  return dbh.select().from(dealers).where(eq(dealers.mobile, mobile)).then((r) => r[0]);
}

export function findDealerById(dbh: DbOrTx, id: string) {
  return dbh.select().from(dealers).where(eq(dealers.id, id)).then((r) => r[0]);
}

export function findDealerByCode(dbh: DbOrTx, dealerCode: string) {
  return dbh.select().from(dealers).where(eq(dealers.dealerCode, dealerCode)).then((r) => r[0]);
}

export type NewDealer = {
  name: string;
  contactPerson: string;
  mobile: string;
  email: string | null;
  cityId: string;
  state: string;
  pin: string;
  place: string | null;
  address: string;
  registeredVia: 'self' | 'admin';
};

export async function insertDealer(tx: Tx, input: NewDealer) {
  const [row] = await tx.insert(dealers).values({ ...input, status: 'pending_approval' }).returning();
  return row!;
}

// users is owned by the (not yet built) `users` module — this insert is temporary here,
// scoped to exactly what registration needs, and moves to users.createDealerUserInTx
// once that module exists (modules.md §4 single-writer rule).
export type NewDealerUser = {
  dealerId: string;
  name: string;
  mobile: string;
  email: string | null;
  passwordHash: string;
};

export function findUsersByDealerId(dbh: DbOrTx, dealerId: string) {
  return dbh.select().from(users).where(eq(users.dealerId, dealerId));
}

export async function insertDealerUser(tx: Tx, input: NewDealerUser) {
  const [row] = await tx
    .insert(users)
    .values({ scope: 'dealer', dealerId: input.dealerId, name: input.name, mobile: input.mobile, email: input.email, passwordHash: input.passwordHash, role: 'dealer_manager' })
    .returning();
  return row!;
}

export type DealerStatusUpdate = {
  status: (typeof dealerStatus.enumValues)[number];
  dealerCode?: string;
  statusReason: string;
  statusChangedBy: string;
};

export async function updateDealerStatus(tx: Tx, id: string, input: DealerStatusUpdate) {
  const [row] = await tx
    .update(dealers)
    .set({ status: input.status, dealerCode: input.dealerCode, statusReason: input.statusReason, statusChangedAt: new Date(), statusChangedBy: input.statusChangedBy, updatedAt: new Date() })
    .where(eq(dealers.id, id))
    .returning();
  return row!;
}

export type DealerProfileUpdate = { contactPerson?: string; email?: string | null; address?: string; place?: string | null };

export async function updateDealerProfile(tx: Tx, id: string, input: DealerProfileUpdate) {
  const [row] = await tx.update(dealers).set({ ...input, updatedAt: new Date() }).where(eq(dealers.id, id)).returning();
  return row!;
}

export type DealerListFilter = { status?: (typeof dealerStatus.enumValues)[number]; limit: number; cursor?: { createdAt: Date; id: string } };

// Simple keyset pagination (rules.md §10 — cursor-based, tiebreaker on id). Not yet
// extracted into a shared utils/pagination.ts — worth doing once a second list endpoint needs it.
export async function listDealers(dbh: DbOrTx, filter: DealerListFilter) {
  const conditions = [
    filter.status ? eq(dealers.status, filter.status) : undefined,
    filter.cursor
      ? or(lt(dealers.createdAt, filter.cursor.createdAt), and(eq(dealers.createdAt, filter.cursor.createdAt), lt(dealers.id, filter.cursor.id)))
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await dbh
    .select()
    .from(dealers)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(dealers.createdAt), desc(dealers.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null;
  return { items, nextCursor };
}
