import { and, desc, eq, lt, or } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { batteries, batteryState } from '../../models/batteries.model';
import { batteryModels } from '../../models/masters.model';
import { replacementLinks, warrantyChains } from '../../models/warranty.model';

type DbOrTx = typeof db | Tx;

export function findBatteryByCode(dbh: DbOrTx, code: string) {
  return dbh.select().from(batteries).where(eq(batteries.batteryCode, code)).then((r) => r[0]);
}

export function findBatteryById(dbh: DbOrTx, id: string) {
  return dbh.select().from(batteries).where(eq(batteries.id, id)).then((r) => r[0]);
}

export function findModelById(dbh: DbOrTx, id: string) {
  return dbh.select().from(batteryModels).where(eq(batteryModels.id, id)).then((r) => r[0]);
}

export function listModels(dbh: DbOrTx) {
  return dbh.select().from(batteryModels);
}

export function findChainById(dbh: DbOrTx, id: string) {
  return dbh.select().from(warrantyChains).where(eq(warrantyChains.id, id)).then((r) => r[0]);
}

export type NewBattery = {
  batteryCode: string;
  batteryCodeEntered: string;
  serialNo: string;
  modelId: string;
  mfgMonth: string | null;
  state: (typeof batteryState.enumValues)[number];
  custodian: 'company' | 'dealer' | 'customer' | 'transit';
  dealerId: string | null;
  origin: 'entry' | 'import' | 'admin' | 'migration';
  chainId?: string;
  replacedFromId?: string;
};

export async function insertBattery(tx: Tx, input: NewBattery) {
  const [row] = await tx.insert(batteries).values(input).returning();
  return row!;
}

export async function updateBatteryAfterReplacement(tx: Tx, id: string, replacedById: string) {
  const [row] = await tx
    .update(batteries)
    .set({ replacedById, state: 'returned', custodian: 'dealer', updatedAt: new Date() })
    .where(eq(batteries.id, id))
    .returning();
  return row!;
}

// For a sales_return, not a replacement — no replacedById involved, nothing "replaces" this
// battery. A separate function on purpose so a sales-return can't accidentally set
// replacedById to the battery's own id (a real bug caught while wiring entries.approve).
export async function updateBatteryToReturned(tx: Tx, id: string) {
  const [row] = await tx.update(batteries).set({ state: 'returned', custodian: 'dealer', updatedAt: new Date() }).where(eq(batteries.id, id)).returning();
  return row!;
}

export async function updateBatteryChainId(tx: Tx, id: string, chainId: string) {
  const [row] = await tx.update(batteries).set({ chainId, updatedAt: new Date() }).where(eq(batteries.id, id)).returning();
  return row!;
}

export async function insertChain(tx: Tx, input: { rootBatteryId: string; warrantyStart: string; warrantyExpiry: string; termMonths: number }) {
  const [row] = await tx.insert(warrantyChains).values(input).returning();
  return row!;
}

export async function incrementChainReplacementCount(tx: Tx, id: string, newCount: number) {
  const [row] = await tx.update(warrantyChains).set({ replacementCount: newCount, updatedAt: new Date() }).where(eq(warrantyChains.id, id)).returning();
  return row!;
}

export async function insertReplacementLink(tx: Tx, input: { oldBatteryId: string; newBatteryId: string; chainId: string; replacedAt: string }) {
  const [row] = await tx.insert(replacementLinks).values(input).returning();
  return row!;
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
