import { and, desc, eq, lt, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
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

// The link that put THIS battery into its chain (null for the chain's original battery).
export function findReplacementLinkByNewBatteryId(dbh: DbOrTx, newBatteryId: string) {
  return dbh.select().from(replacementLinks).where(eq(replacementLinks.newBatteryId, newBatteryId)).then((r) => r[0]);
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

// Only the "who replaced me" pointer — the state/custody change itself is a stock movement
// (stock.postMovementInTx), so the ledger and the battery row can never disagree.
export async function updateBatteryReplacedBy(tx: Tx, id: string, replacedById: string) {
  const [row] = await tx.update(batteries).set({ replacedById, updatedAt: new Date() }).where(eq(batteries.id, id)).returning();
  return row!;
}

// Called by stock.postMovementInTx only (modules.md §4 — batteries owns the row, stock owns the
// movement). Everything else that wants to change a battery's state goes through stock.
export async function applyMovement(tx: Tx, id: string, input: { state: (typeof batteryState.enumValues)[number]; custodian: 'company' | 'dealer' | 'customer' | 'transit'; dealerId: string | null }) {
  const [row] = await tx.update(batteries).set({ ...input, updatedAt: new Date() }).where(eq(batteries.id, id)).returning();
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

  // The app's battery screens show cover dates and the chain link, so the chain and the
  // replaced battery's code ride along instead of a lookup per row.
  const replaced = alias(batteries, 'replaced');
  const rows = await dbh
    .select({ battery: batteries, warrantyStart: warrantyChains.warrantyStart, warrantyExpiry: warrantyChains.warrantyExpiry, replacementCount: warrantyChains.replacementCount, replacedFromCode: replaced.batteryCode })
    .from(batteries)
    .leftJoin(warrantyChains, eq(warrantyChains.id, batteries.chainId))
    .leftJoin(replaced, eq(replaced.id, batteries.replacedFromId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(batteries.createdAt), desc(batteries.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const items = (hasMore ? rows.slice(0, filter.limit) : rows).map((r) => ({
    ...r.battery,
    warrantyStart: r.warrantyStart,
    warrantyExpiry: r.warrantyExpiry,
    replacementCount: r.replacementCount,
    replacedFromCode: r.replacedFromCode,
  }));
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null;
  return { items, nextCursor };
}
