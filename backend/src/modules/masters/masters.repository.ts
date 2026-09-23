import { eq } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { cities, plateTypes } from '../../models/masters.model';

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
