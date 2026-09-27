import { and, desc, eq } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { batteries } from '../../models/batteries.model';
import { overrideStatus, warrantyChains, warrantyOverrides } from '../../models/warranty.model';

type DbOrTx = typeof db | Tx;
export type OverrideStatus = (typeof overrideStatus.enumValues)[number];

export function findOverrideById(dbh: DbOrTx, id: string) {
  return dbh.select().from(warrantyOverrides).where(eq(warrantyOverrides.id, id)).then((r) => r[0]);
}

/** A chain may only have one request in flight — otherwise two admins could extend it twice. */
export function findPendingForChain(dbh: DbOrTx, chainId: string) {
  return dbh
    .select()
    .from(warrantyOverrides)
    .where(and(eq(warrantyOverrides.chainId, chainId), eq(warrantyOverrides.status, 'pending')))
    .then((r) => r[0]);
}

export type NewOverride = typeof warrantyOverrides.$inferInsert;

export async function insertOverride(tx: Tx, input: NewOverride) {
  const [row] = await tx.insert(warrantyOverrides).values(input).returning();
  return row!;
}

export async function updateOverrideDecision(
  tx: Tx,
  id: string,
  input: { status: OverrideStatus; decidedBy: string; decisionReason: string; decidedAt: Date; expiryBefore?: string; expiryAfter?: string },
) {
  const [row] = await tx.update(warrantyOverrides).set(input).where(eq(warrantyOverrides.id, id)).returning();
  return row!;
}

/** Extends the chain's cover, keeping what it was before — the chain stays the single source of dates. */
export async function extendChainExpiry(tx: Tx, chainId: string, input: { expiryBefore: string; expiryAfter: string }) {
  const [row] = await tx
    .update(warrantyChains)
    .set({ warrantyExpiry: input.expiryAfter, expiryBeforeOverride: input.expiryBefore, updatedAt: new Date() })
    .where(eq(warrantyChains.id, chainId))
    .returning();
  return row!;
}

export async function listOverrides(dbh: DbOrTx, filter: { status?: OverrideStatus; dealerId?: string; limit: number }) {
  const conditions = [
    filter.status ? eq(warrantyOverrides.status, filter.status) : undefined,
    filter.dealerId ? eq(warrantyOverrides.dealerId, filter.dealerId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await dbh
    .select({ override: warrantyOverrides, batteryCode: batteries.batteryCode, modelId: batteries.modelId, warrantyExpiry: warrantyChains.warrantyExpiry })
    .from(warrantyOverrides)
    .innerJoin(batteries, eq(batteries.id, warrantyOverrides.batteryId))
    .innerJoin(warrantyChains, eq(warrantyChains.id, warrantyOverrides.chainId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(warrantyOverrides.requestedAt))
    .limit(filter.limit);

  return { items: rows.map((r) => ({ ...r.override, batteryCode: r.batteryCode, modelId: r.modelId, warrantyExpiry: r.warrantyExpiry })) };
}
