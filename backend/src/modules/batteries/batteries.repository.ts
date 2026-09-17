import { and, desc, eq, lt, or } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { batteries, batteryState } from '../../models/batteries.model';
import { batteryModels } from '../../models/masters.model';

type DbOrTx = typeof db | Tx;

export function findBatteryByCode(dbh: DbOrTx, code: string) {
  return dbh.select().from(batteries).where(eq(batteries.batteryCode, code)).then((r) => r[0]);
}

export function findModelById(dbh: DbOrTx, id: string) {
  return dbh.select().from(batteryModels).where(eq(batteryModels.id, id)).then((r) => r[0]);
}

export function listModels(dbh: DbOrTx) {
  return dbh.select().from(batteryModels);
}

export type BatteryListFilter = { state?: (typeof batteryState.enumValues)[number]; dealerId?: string; limit: number; cursor?: { createdAt: Date; id: string } };

// Same keyset-pagination shape as dealers.repository.listDealers — still not extracted
// into a shared utils/pagination.ts (rules.md §10); worth doing once a third list needs it.
export async function listBatteries(dbh: DbOrTx, filter: BatteryListFilter) {
  const conditions = [
    filter.state ? eq(batteries.state, filter.state) : undefined,
    filter.dealerId ? eq(batteries.dealerId, filter.dealerId) : undefined,
    filter.cursor
      ? or(lt(batteries.createdAt, filter.cursor.createdAt), and(eq(batteries.createdAt, filter.cursor.createdAt), lt(batteries.id, filter.cursor.id)))
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await dbh
    .select()
    .from(batteries)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(batteries.createdAt), desc(batteries.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null;
  return { items, nextCursor };
}
