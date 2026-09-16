import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, type Tx } from '../../database/client';
import { dealers, loginAttempts, otpChallenges, sessions, users } from '../../models/identity.model';

type DbOrTx = typeof db | Tx;

export function findUserByMobile(dbh: DbOrTx, mobile: string) {
  return dbh.select().from(users).where(and(eq(users.mobile, mobile), eq(users.scope, 'dealer'))).then((r) => r[0]);
}

export function findUserByEmail(dbh: DbOrTx, email: string) {
  return dbh.select().from(users).where(eq(users.email, email)).then((r) => r[0]);
}

export function findUserById(dbh: DbOrTx, id: string) {
  return dbh.select().from(users).where(eq(users.id, id)).then((r) => r[0]);
}

export function findDealerById(dbh: DbOrTx, id: string) {
  return dbh.select().from(dealers).where(eq(dealers.id, id)).then((r) => r[0]);
}

export function updateUserPasswordHash(tx: Tx, userId: string, passwordHash: string) {
  return tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
}

export function updateUserLastLogin(tx: Tx, userId: string) {
  return tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

// --- OTP challenges ---------------------------------------------------------

export type NewOtpChallenge = {
  purpose: (typeof otpChallenges.purpose.enumValues)[number];
  target: string;
  codeHash: string;
  userId: string | null;
  maxAttempts: number;
  expiresAt: Date;
  createdIp: string | null;
};

export async function insertOtpChallenge(dbh: DbOrTx, input: NewOtpChallenge) {
  const [row] = await dbh.insert(otpChallenges).values(input).returning();
  return row!;
}

export function findOtpChallenge(dbh: DbOrTx, id: string) {
  return dbh.select().from(otpChallenges).where(eq(otpChallenges.id, id)).then((r) => r[0]);
}

export function incrementOtpAttempts(tx: Tx, id: string, attempts: number) {
  return tx.update(otpChallenges).set({ attempts }).where(eq(otpChallenges.id, id));
}

export function consumeOtpChallenge(tx: Tx, id: string) {
  return tx.update(otpChallenges).set({ consumedAt: new Date() }).where(eq(otpChallenges.id, id));
}

// count non-expired challenges for a target+purpose in the last `windowMin` minutes —
// a DB-backed stand-in for the Redis token-bucket rate limit until `ratelimit.ts`/Redis land.
export async function countRecentOtpChallenges(dbh: DbOrTx, target: string, purpose: string, since: Date) {
  const rows = await dbh
    .select({ id: otpChallenges.id })
    .from(otpChallenges)
    .where(and(eq(otpChallenges.target, target), eq(otpChallenges.purpose, purpose as never), gt(otpChallenges.createdAt, since)));
  return rows.length;
}

// --- sessions ----------------------------------------------------------------

export type NewSession = {
  userId: string;
  refreshHash: string;
  familyId: string;
  deviceId: string | null;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
};

export async function insertSession(tx: Tx, input: NewSession) {
  const [row] = await tx.insert(sessions).values(input).returning();
  return row!;
}

export function findSessionByRefreshHash(dbh: DbOrTx, refreshHash: string) {
  return dbh.select().from(sessions).where(eq(sessions.refreshHash, refreshHash)).then((r) => r[0]);
}

export function revokeSession(tx: Tx, id: string, reason: string, replacedBy?: string) {
  return tx.update(sessions).set({ revokedAt: new Date(), revokedReason: reason, replacedBy }).where(eq(sessions.id, id));
}

export function revokeSessionFamily(tx: Tx, familyId: string, reason: string) {
  return tx
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
}

export function revokeAllSessionsForUser(tx: Tx, userId: string, reason: string) {
  return tx.update(sessions).set({ revokedAt: new Date(), revokedReason: reason }).where(eq(sessions.userId, userId));
}

// --- login attempts / lockout -------------------------------------------------

export function insertLoginAttempt(tx: Tx, target: string, ip: string | null, outcome: (typeof loginAttempts.outcome.enumValues)[number]) {
  return tx.insert(loginAttempts).values({ target, ip, outcome });
}

export async function countRecentBadLogins(dbh: DbOrTx, target: string, since: Date) {
  const rows = await dbh
    .select({ id: loginAttempts.id })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.target, target), gt(loginAttempts.at, since), eq(loginAttempts.outcome, 'bad_password')));
  return rows.length;
}
