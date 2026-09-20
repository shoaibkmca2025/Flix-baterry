import { db, withTransaction } from '../../database/client';
import { canChangeUserStatus, type UserStatus } from '../../domain/status';
import type { users } from '../../models/identity.model';
import { getEffectivePermissions, permissionGranted } from '../../middleware/rbac';
import { audit } from '../../utils/audit';
import type { Ctx } from '../../utils/context';
import { hashPassword } from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import { revokeAllSessionsForUser } from '../auth/auth.repository';
import { findDealerById } from '../dealers/dealers.repository';
import * as repo from './users.repository';
import type { AdminCreateBody, AdminUpdateBody, MeUpdateBody, StaffInviteBody, StaffUpdateBody, UserStatusBody } from './users.validation';

// M-03 users (+ the V1 slice of M-04 admins) — modules.md. One `users` table for dealer staff
// and head office. Owns users + user_permissions; reads roles and dealers.

type User = typeof users.$inferSelect;

function requireUser(ctx: Ctx) {
  if (!ctx.user) throw new AppError('unauthenticated', 401, 'Sign in required.');
  return ctx.user;
}

// Never return hashes/secrets — the public shape of a user everywhere in this module.
export function publicUser(u: User) {
  return {
    id: u.id,
    scope: u.scope,
    dealerId: u.dealerId,
    name: u.name,
    mobile: u.mobile,
    email: u.email,
    role: u.role,
    status: u.status,
    statusReason: u.statusReason,
    lastLoginAt: u.lastLoginAt,
    language: u.language,
    smsAlerts: u.smsAlerts,
    createdAt: u.createdAt,
  };
}

// ---------------------------------------------------------------------------------------------
// Per-request account status (INV-status-every-request, rules.md). Cached briefly so it costs
// one query per user per 30 s, and invalidated the moment a status changes here or in dealers.
// ---------------------------------------------------------------------------------------------
const STATUS_TTL_MS = 30_000;
const statusCache = new Map<string, { until: number; value: Awaited<ReturnType<typeof repo.findAccountStatus>> }>();

export function invalidateAccountStatus(userId?: string) {
  if (userId) statusCache.delete(userId);
  else statusCache.clear();
}

export async function assertAccountActive(userId: string, now = Date.now()) {
  let hit = statusCache.get(userId);
  if (!hit || hit.until <= now) {
    hit = { until: now + STATUS_TTL_MS, value: await repo.findAccountStatus(db, userId) };
    statusCache.set(userId, hit);
  }
  const acct = hit.value;
  if (!acct || acct.userStatus !== 'active') {
    throw new AppError('account_blocked', 403, 'This account is not active.', { details: { status: acct?.userStatus ?? 'missing' } });
  }
  if (acct.dealerId && acct.dealerStatus !== 'active') {
    throw new AppError('dealer_not_active', 403, `This shop is ${(acct.dealerStatus ?? 'unknown').replace('_', ' ')}.`, { details: { status: acct.dealerStatus, dealerId: acct.dealerId } });
  }
}

// ---------------------------------------------------------------------------------------------
// /me
// ---------------------------------------------------------------------------------------------
export async function getMe(ctx: Ctx) {
  const auth = requireUser(ctx);
  const user = await repo.findUserById(db, auth.id);
  if (!user) throw new AppError('unauthenticated', 401, 'Sign in required.');
  const [dealer, permissions] = await Promise.all([user.dealerId ? findDealerById(db, user.dealerId) : undefined, getEffectivePermissions(user.id, user.role)]);
  return {
    user: publicUser(user),
    dealer: dealer ? { id: dealer.id, dealerCode: dealer.dealerCode, name: dealer.name, status: dealer.status, cityId: dealer.cityId } : null,
    permissions: [...permissions].sort(),
  };
}

export async function updateMe(ctx: Ctx, input: MeUpdateBody) {
  const auth = requireUser(ctx);
  const user = await repo.findUserById(db, auth.id);
  if (!user) throw new AppError('unauthenticated', 401, 'Sign in required.');
  return withTransaction(async (tx) => {
    const updated = await repo.updateUser(tx, user.id, input);
    await audit(tx, { ctx, action: 'user.updated', entityType: 'user', entityId: user.id, before: pick(user, input), after: pick(updated, input), outcome: 'ok' });
    return publicUser(updated);
  });
}

// ---------------------------------------------------------------------------------------------
// Dealer staff — dealers.staff.manage: admins for any dealer, a dealer_manager for their own.
// ---------------------------------------------------------------------------------------------
async function resolveDealer(ctx: Ctx, dealerId: string) {
  const auth = requireUser(ctx);
  if (auth.scope === 'dealer' && auth.dealerId !== dealerId) {
    throw new AppError('dealer_not_found', 404, 'Shop not found.'); // 404, not 403 — no existence leak (I-3)
  }
  const dealer = await findDealerById(db, dealerId);
  if (!dealer) throw new AppError('dealer_not_found', 404, 'Shop not found.');
  return dealer;
}

async function loadStaff(dealerId: string, userId: string) {
  const user = await repo.findUserById(db, userId);
  if (!user || user.dealerId !== dealerId) throw new AppError('user_not_found', 404, 'Staff member not found.');
  return user;
}

export async function listStaff(ctx: Ctx, dealerId: string) {
  await resolveDealer(ctx, dealerId);
  const rows = await repo.listUsersByDealer(db, dealerId);
  return rows.map(publicUser);
}

async function assertIdentifiersFree(input: { mobile?: string | null; email?: string | null }) {
  if (input.mobile && (await repo.findUserByMobile(db, input.mobile))) throw new AppError('identifier_taken', 409, 'That mobile number already has an account.', { field: 'mobile' });
  if (input.email && (await repo.findUserByEmail(db, input.email))) throw new AppError('identifier_taken', 409, 'That email already has an account.', { field: 'email' });
}

export async function inviteStaff(ctx: Ctx, dealerId: string, input: StaffInviteBody) {
  const auth = requireUser(ctx);
  await resolveDealer(ctx, dealerId);
  await assertIdentifiersFree(input);
  return withTransaction(async (tx) => {
    // no password: dealer staff sign in with mobile + OTP (memory.md D-09), so the invite is
    // complete as soon as the row exists — the SMS "you've been added" waits for notifications.
    const user = await repo.insertUser(tx, { scope: 'dealer', dealerId, name: input.name, mobile: input.mobile, email: input.email ?? null, role: input.role, createdBy: auth.id });
    await audit(tx, { ctx, action: 'user.created', entityType: 'user', entityId: user.id, after: { name: user.name, mobile: user.mobile, role: user.role, dealerId }, outcome: 'ok' });
    return publicUser(user);
  });
}

// Extra grants can never exceed what the grantor holds (modules.md M-03 `grant_exceeds_grantor`).
async function assertGrantsWithinGrantor(ctx: Ctx, permissions: string[]) {
  const auth = requireUser(ctx);
  const mine = await getEffectivePermissions(auth.id, auth.role);
  const over = permissions.filter((p) => !permissionGranted(mine, p));
  if (over.length) throw new AppError('grant_exceeds_grantor', 403, `You cannot grant what you do not hold: ${over.join(', ')}.`, { field: 'permissions' });
}

export async function updateStaff(ctx: Ctx, dealerId: string, userId: string, input: StaffUpdateBody) {
  const auth = requireUser(ctx);
  await resolveDealer(ctx, dealerId);
  const user = await loadStaff(dealerId, userId);
  if (input.role && input.role !== user.role && user.id === auth.id) throw new AppError('cannot_change_own_role', 409, 'You cannot change your own role.');
  if (input.permissions) await assertGrantsWithinGrantor(ctx, input.permissions);

  return withTransaction(async (tx) => {
    const updated = await repo.updateUser(tx, user.id, { name: input.name, role: input.role });
    if (input.permissions) {
      const before = await repo.listGrants(tx, user.id);
      await repo.replaceGrants(tx, user.id, auth.id, input.permissions);
      await audit(tx, { ctx, action: 'user.permission_granted', entityType: 'user', entityId: user.id, before: { permissions: before }, after: { permissions: input.permissions }, outcome: 'ok' });
    }
    await audit(tx, { ctx, action: 'user.updated', entityType: 'user', entityId: user.id, before: { name: user.name, role: user.role }, after: { name: updated.name, role: updated.role }, outcome: 'ok' });
    invalidateAccountStatus(user.id);
    return publicUser(updated);
  });
}

async function changeStatus(ctx: Ctx, user: User, input: UserStatusBody, entityLabel: 'user' | 'admin') {
  const auth = requireUser(ctx);
  if (user.id === auth.id) throw new AppError('cannot_change_own_status', 409, 'You cannot change your own account status.');
  if (!canChangeUserStatus(user.status as UserStatus, input.status)) {
    throw new AppError('invalid_transition', 409, `Cannot move this account from ${user.status} to ${input.status}.`);
  }
  if (user.role === 'main_admin' && input.status !== 'active' && user.status === 'active' && (await repo.countActiveMainAdmins(db)) <= 1) {
    throw new AppError('last_main_admin', 409, 'This is the last active Main Admin. Add another before changing this one.');
  }
  return withTransaction(async (tx) => {
    const updated = await repo.updateUserStatus(tx, user.id, { status: input.status, statusReason: input.reason });
    if (input.status !== 'active') await revokeAllSessionsForUser(tx, user.id, `status_${input.status}`);
    await audit(tx, { ctx, action: `${entityLabel}.status_changed`, entityType: 'user', entityId: user.id, before: { status: user.status }, after: { status: input.status }, reason: input.reason, outcome: 'ok' });
    invalidateAccountStatus(user.id);
    return publicUser(updated);
  });
}

export async function setStaffStatus(ctx: Ctx, dealerId: string, userId: string, input: UserStatusBody) {
  await resolveDealer(ctx, dealerId);
  const user = await loadStaff(dealerId, userId);
  return changeStatus(ctx, user, input, 'user');
}

// ---------------------------------------------------------------------------------------------
// Admin accounts — admins.manage (main_admin only via '*').
// ---------------------------------------------------------------------------------------------
async function resolveAdminRole(ctx: Ctx, key: string) {
  const auth = requireUser(ctx);
  const role = await repo.findRoleByKey(db, key);
  if (!role || role.scope !== 'admin') throw new AppError('role_invalid', 422, 'Choose a head-office role.', { field: 'role' });
  if (role.key === 'main_admin' && auth.role !== 'main_admin') throw new AppError('escalation_denied', 403, 'Only a Main Admin can create another Main Admin.');
  return role;
}

async function loadAdmin(userId: string) {
  const user = await repo.findUserById(db, userId);
  if (!user || user.scope !== 'admin') throw new AppError('user_not_found', 404, 'Admin not found.');
  return user;
}

export async function listAdmins(ctx: Ctx) {
  requireUser(ctx);
  const rows = await repo.listAdmins(db);
  return rows.map(publicUser);
}

export async function createAdmin(ctx: Ctx, input: AdminCreateBody) {
  const auth = requireUser(ctx);
  await resolveAdminRole(ctx, input.role);
  await assertIdentifiersFree(input);
  const passwordHash = await hashPassword(input.password);
  return withTransaction(async (tx) => {
    const user = await repo.insertUser(tx, { scope: 'admin', name: input.name, email: input.email, mobile: input.mobile ?? null, passwordHash, role: input.role, mfa: 'email_otp', createdBy: auth.id });
    await audit(tx, { ctx, action: 'admin.created', entityType: 'user', entityId: user.id, after: { name: user.name, email: user.email, role: user.role }, outcome: 'ok' });
    return publicUser(user);
  });
}

export async function updateAdmin(ctx: Ctx, userId: string, input: AdminUpdateBody) {
  const auth = requireUser(ctx);
  const user = await loadAdmin(userId);
  if (input.role && input.role !== user.role) {
    if (user.id === auth.id) throw new AppError('cannot_change_own_role', 409, 'You cannot change your own role.');
    await resolveAdminRole(ctx, input.role);
    if (user.role === 'main_admin' && user.status === 'active' && (await repo.countActiveMainAdmins(db)) <= 1) {
      throw new AppError('last_main_admin', 409, 'This is the last active Main Admin. Add another before changing this one.');
    }
  }
  if (input.permissions) await assertGrantsWithinGrantor(ctx, input.permissions);

  return withTransaction(async (tx) => {
    const updated = await repo.updateUser(tx, user.id, { name: input.name, role: input.role });
    if (input.permissions) {
      const before = await repo.listGrants(tx, user.id);
      await repo.replaceGrants(tx, user.id, auth.id, input.permissions);
      await audit(tx, { ctx, action: 'user.permission_granted', entityType: 'user', entityId: user.id, before: { permissions: before }, after: { permissions: input.permissions }, outcome: 'ok' });
    }
    await audit(tx, { ctx, action: 'admin.updated', entityType: 'user', entityId: user.id, before: { name: user.name, role: user.role }, after: { name: updated.name, role: updated.role }, outcome: 'ok' });
    return publicUser(updated);
  });
}

export async function setAdminStatus(ctx: Ctx, userId: string, input: UserStatusBody) {
  const user = await loadAdmin(userId);
  return changeStatus(ctx, user, input, 'admin');
}

// Kicks every session; the admin then signs back in via /auth/password/forgot (email OTP).
export async function resetAccess(ctx: Ctx, userId: string) {
  requireUser(ctx);
  const user = await loadAdmin(userId);
  return withTransaction(async (tx) => {
    await revokeAllSessionsForUser(tx, user.id, 'access_reset');
    await audit(tx, { ctx, action: 'admin.access_reset', entityType: 'user', entityId: user.id, outcome: 'ok' });
    invalidateAccountStatus(user.id);
    return { id: user.id, sessionsRevoked: true };
  });
}

export async function listRoles(ctx: Ctx) {
  requireUser(ctx);
  return repo.listRoles(db);
}

function pick(u: User, input: MeUpdateBody) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(input) as (keyof MeUpdateBody)[]) out[k] = u[k];
  return out;
}
