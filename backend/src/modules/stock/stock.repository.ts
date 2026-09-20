import { and, count, desc, eq, lt, or } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { batteries } from '../../models/batteries.model';
import { stockMovements } from '../../models/stock.model';

type DbOrTx = typeof db | Tx;

export type NewMovement = typeof stockMovements.$inferInsert;

export async function insertMovement(tx: Tx, input: NewMovement) {
  const [row] = await tx.insert(stockMovements).values(input).returning();
  return row!;
}

export function findMovementById(dbh: DbOrTx, id: string) {
  return dbh.select().from(stockMovements).where(eq(stockMovements.id, id)).then((r) => r[0]);
}

export type MovementListFilter = { batteryId?: string; dealerId?: string; reasonCode?: string; limit: number; cursor?: { postedAt: Date; id: string } };

// Newest first, keyset on (posted_at, id). A dealer filter matches either side of the move —
// the ledger shows a dealer everything that came to them or left them.
export async function listMovements(dbh: DbOrTx, filter: MovementListFilter) {
  const conditions = [
    filter.batteryId ? eq(stockMovements.batteryId, filter.batteryId) : undefined,
    filter.dealerId ? or(eq(stockMovements.toDealerId, filter.dealerId), eq(stockMovements.fromDealerId, filter.dealerId)) : undefined,
    filter.reasonCode ? eq(stockMovements.reasonCode, filter.reasonCode) : undefined,
    filter.cursor ? or(lt(stockMovements.postedAt, filter.cursor.postedAt), and(eq(stockMovements.postedAt, filter.cursor.postedAt), lt(stockMovements.id, filter.cursor.id))) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await dbh
    .select({ movement: stockMovements, batteryCode: batteries.batteryCode, modelId: batteries.modelId })
    .from(stockMovements)
    .innerJoin(batteries, eq(batteries.id, stockMovements.batteryId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(stockMovements.postedAt), desc(stockMovements.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const items = (hasMore ? rows.slice(0, filter.limit) : rows).map((r) => ({ ...r.movement, batteryCode: r.batteryCode, modelId: r.modelId }));
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ postedAt: last.postedAt.toISOString(), id: last.id })).toString('base64url') : null;
  return { items, nextCursor };
}

// Positions are DERIVED from batteries' current state (architecture.md §9.6) — never a
// separately maintained count that could drift from the ledger.
export async function positionsBy(dbh: DbOrTx, by: 'state' | 'model' | 'dealer', dealerId?: string) {
  const key = by === 'state' ? batteries.state : by === 'model' ? batteries.modelId : batteries.dealerId;
  const rows = await dbh
    .select({ key, state: batteries.state, count: count() })
    .from(batteries)
    .where(dealerId ? eq(batteries.dealerId, dealerId) : undefined)
    .groupBy(key, batteries.state);
  return rows.map((r) => ({ key: r.key === null ? null : String(r.key), state: r.state, count: Number(r.count) }));
}
