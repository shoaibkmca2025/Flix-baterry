import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { cities, plants, plateTypes } from '../../models/masters.model';

type DbOrTx = typeof db | Tx;

export function listCities(dbh: DbOrTx) {
  return dbh.select().from(cities);
}

export function findCityById(dbh: DbOrTx, id: string) {
  return dbh.select().from(cities).where(eq(cities.id, id)).then((r) => r[0]);
}

export function findCityByName(dbh: DbOrTx, name: string) {
  return dbh.select().from(cities).where(eq(cities.name, name)).then((r) => r[0]);
}

export async function insertCity(tx: Tx, input: { name: string; state: string }) {
  const [row] = await tx.insert(cities).values(input).returning();
  return row!;
}

export async function updateCity(tx: Tx, id: string, input: { name?: string; state?: string; active?: boolean }) {
  const [row] = await tx.update(cities).set(input).where(eq(cities.id, id)).returning();
  return row!;
}

export function listPlateTypes(dbh: DbOrTx) {
  return dbh.select().from(plateTypes).orderBy(plateTypes.sortOrder, plateTypes.code);
}

// ---- plants (D-19). Listed in the order they were added — the dropdown's order.
export function listPlants(dbh: DbOrTx) {
  return dbh.select().from(plants).orderBy(asc(plants.createdAt), asc(plants.id));
}

export function findPlantById(dbh: DbOrTx, id: string) {
  return dbh.select().from(plants).where(eq(plants.id, id)).then((r) => r[0] ?? null);
}

/** "branch 2" and "Branch 2" are the same plant to the person choosing from the dropdown. */
export function findPlantByName(dbh: DbOrTx, name: string, exceptId?: string) {
  const sameName = sql`lower(${plants.name}) = lower(${name})`;
  return dbh
    .select()
    .from(plants)
    .where(exceptId ? and(sameName, ne(plants.id, exceptId)) : sameName)
    .then((r) => r[0] ?? null);
}

export function countActivePlants(dbh: DbOrTx) {
  return dbh.select({ n: sql<number>`count(*)::int` }).from(plants).where(eq(plants.active, true)).then((r) => r[0]?.n ?? 0);
}

export async function insertPlant(tx: Tx, input: { name: string }) {
  const [row] = await tx.insert(plants).values(input).returning();
  return row!;
}

export async function updatePlant(tx: Tx, id: string, input: { name?: string; active?: boolean }, at: Date) {
  const [row] = await tx.update(plants).set({ ...input, updatedAt: at }).where(eq(plants.id, id)).returning();
  return row!;
}
