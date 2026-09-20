import { and, count, eq } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { dealers, roles, userPermissions, users } from '../../models/identity.model';

type DbOrTx = typeof db | Tx;

export function findUserById(dbh: DbOrTx, id: string) {
  return dbh.select().from(users).where(eq(users.id, id)).then((r) => r[0]);
}

export function findUserByMobile(dbh: DbOrTx, mobile: string) {
  return dbh.select().from(users).where(eq(users.mobile, mobile)).then((r) => r[0]);
}

export function findUserByEmail(dbh: DbOrTx, email: string) {
  return dbh.select().from(users).where(eq(users.email, email)).then((r) => r[0]);
}

// One round trip for the per-request account check: the user's status plus their dealer's.
export function findAccountStatus(dbh: DbOrTx, id: string) {
  return dbh
    .select({ userStatus: users.status, dealerStatus: dealers.status, dealerId: users.dealerId })
    .from(users)
    .leftJoin(dealers, eq(dealers.id, users.dealerId))
    .where(eq(users.id, id))
    .then((r) => r[0]);
}

export function listUsersByDealer(dbh: DbOrTx, dealerId: string) {
  return dbh.select().from(users).where(eq(users.dealerId, dealerId)).orderBy(users.createdAt);
}

export function listAdmins(dbh: DbOrTx) {
  return dbh.select().from(users).where(eq(users.scope, 'admin')).orderBy(users.createdAt);
}

export type NewUser = typeof users.$inferInsert;

export async function insertUser(tx: Tx, input: NewUser) {
  const [row] = await tx.insert(users).values(input).returning();
  return row!;
}

export type UserUpdate = { name?: string; role?: string; language?: 'en' | 'mr'; smsAlerts?: boolean };

export async function updateUser(tx: Tx, id: string, input: UserUpdate) {
  const [row] = await tx.update(users).set({ ...input, updatedAt: new Date() }).where(eq(users.id, id)).returning();
  return row!;
}

export async function updateUserStatus(tx: Tx, id: string, input: { status: 'active' | 'temporarily_blocked' | 'inactive' | 'soft_deleted'; statusReason: string }) {
  const [row] = await tx.update(users).set({ ...input, updatedAt: new Date() }).where(eq(users.id, id)).returning();
  return row!;
}

export async function countActiveMainAdmins(dbh: DbOrTx) {
  const [row] = await dbh.select({ n: count() }).from(users).where(and(eq(users.scope, 'admin'), eq(users.role, 'main_admin'), eq(users.status, 'active')));
  return Number(row?.n ?? 0);
}

export function listRoles(dbh: DbOrTx) {
  return dbh.select().from(roles).orderBy(roles.scope, roles.key);
}

export function findRoleByKey(dbh: DbOrTx, key: string) {
  return dbh.select().from(roles).where(eq(roles.key, key)).then((r) => r[0]);
}

export function listGrants(dbh: DbOrTx, userId: string) {
  return dbh.select({ permission: userPermissions.permission }).from(userPermissions).where(eq(userPermissions.userId, userId)).then((rows) => rows.map((r) => r.permission));
}

export async function replaceGrants(tx: Tx, userId: string, grantedBy: string, permissions: string[]) {
  await tx.delete(userPermissions).where(eq(userPermissions.userId, userId));
  if (permissions.length) await tx.insert(userPermissions).values(permissions.map((permission) => ({ userId, permission, grantedBy })));
}
