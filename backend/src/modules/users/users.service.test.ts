import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({
  db: {},
  withTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('../../utils/audit', () => ({ audit: vi.fn() }));
vi.mock('../../utils/crypto', () => ({ hashPassword: vi.fn(async (p: string) => `hashed:${p}`) }));
vi.mock('../auth/auth.repository', () => ({ revokeAllSessionsForUser: vi.fn() }));
vi.mock('../dealers/dealers.repository', () => ({ findDealerById: vi.fn() }));

vi.mock('../../middleware/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/rbac')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

vi.mock('./users.repository', () => ({
  findUserById: vi.fn(),
  findUserByMobile: vi.fn(),
  findUserByEmail: vi.fn(),
  findAccountStatus: vi.fn(),
  listUsersByDealer: vi.fn(),
  listAdmins: vi.fn(),
  insertUser: vi.fn(async (_tx: unknown, input: object) => ({ id: 'new-user', status: 'active', passwordHash: 'SECRET', ...input })),
  updateUser: vi.fn(async (_tx: unknown, id: string, input: object) => ({ id, ...input })),
  updateUserStatus: vi.fn(async (_tx: unknown, id: string, input: object) => ({ id, ...input })),
  countActiveMainAdmins: vi.fn(),
  listRoles: vi.fn(),
  findRoleByKey: vi.fn(),
  listGrants: vi.fn(async () => []),
  replaceGrants: vi.fn(),
}));

import { getEffectivePermissions } from '../../middleware/rbac';
import { audit } from '../../utils/audit';
import { revokeAllSessionsForUser } from '../auth/auth.repository';
import { findDealerById } from '../dealers/dealers.repository';
import * as repo from './users.repository';
import { assertAccountActive, createAdmin, getMe, inviteStaff, invalidateAccountStatus, listStaff, publicUser, setAdminStatus, setStaffStatus, updateAdmin, updateStaff } from './users.service';
import type { Ctx } from '../../utils/context';

const now = () => new Date('2026-09-19T10:00:00Z');
const base = { request: { id: 'req-1', ip: '127.0.0.1', deviceId: 'device-1', userAgent: 'vitest' }, now };
const mainAdmin: Ctx = { ...base, user: { id: 'admin-1', scope: 'admin', role: 'main_admin' } };
const coAdmin: Ctx = { ...base, user: { id: 'admin-2', scope: 'admin', role: 'co_admin' } };
const manager: Ctx = { ...base, user: { id: 'mgr-1', scope: 'dealer', role: 'dealer_manager', dealerId: 'dealer-1' } };
const anonCtx: Ctx = { ...base, user: null };

const staffRow = { id: 'staff-1', scope: 'dealer', dealerId: 'dealer-1', name: 'Ravi', mobile: '9876543211', email: null, role: 'dealer_user', status: 'active', passwordHash: null };

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAccountStatus();
  vi.mocked(findDealerById).mockResolvedValue({ id: 'dealer-1', dealerCode: 'FPP-014', name: 'Felix Power Point', status: 'active', cityId: 'c-1' } as never);
  vi.mocked(getEffectivePermissions).mockResolvedValue(new Set(['entries.read', 'entries.create', 'claims.read', 'dealers.staff.manage']));
});

describe('publicUser / getMe', () => {
  it('never exposes the password hash or TOTP secret', () => {
    const shape = publicUser({ ...staffRow, passwordHash: 'SECRET', totpSecretEnc: 'SECRET' } as never);
    expect(JSON.stringify(shape)).not.toContain('SECRET');
    expect(shape).toMatchObject({ id: 'staff-1', role: 'dealer_user' });
  });

  it('returns user + dealer + sorted effective permissions', async () => {
    vi.mocked(repo.findUserById).mockResolvedValue({ ...staffRow, id: 'mgr-1', role: 'dealer_manager' } as never);
    const me = await getMe(manager);
    expect(me.dealer).toMatchObject({ dealerCode: 'FPP-014' });
    expect(me.permissions).toEqual(['claims.read', 'dealers.staff.manage', 'entries.create', 'entries.read']);
    await expect(getMe(anonCtx)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('assertAccountActive — every request', () => {
  it('passes an active user of an active dealer, and caches for 30 s', async () => {
    vi.mocked(repo.findAccountStatus).mockResolvedValue({ userStatus: 'active', dealerStatus: 'active', dealerId: 'dealer-1' });
    await assertAccountActive('u-1', 1_000);
    await assertAccountActive('u-1', 20_000);
    expect(repo.findAccountStatus).toHaveBeenCalledTimes(1);
    await assertAccountActive('u-1', 40_000); // TTL passed
    expect(repo.findAccountStatus).toHaveBeenCalledTimes(2);
  });

  it('refuses a blocked user, a suspended dealer, and a missing row; invalidation drops the cache', async () => {
    vi.mocked(repo.findAccountStatus).mockResolvedValueOnce({ userStatus: 'temporarily_blocked', dealerStatus: null, dealerId: null });
    await expect(assertAccountActive('u-2')).rejects.toMatchObject({ code: 'account_blocked' });

    vi.mocked(repo.findAccountStatus).mockResolvedValueOnce({ userStatus: 'active', dealerStatus: 'suspended', dealerId: 'dealer-9' });
    await expect(assertAccountActive('u-3')).rejects.toMatchObject({ code: 'dealer_not_active' });

    vi.mocked(repo.findAccountStatus).mockResolvedValueOnce(undefined);
    await expect(assertAccountActive('u-4')).rejects.toMatchObject({ code: 'account_blocked' });

    vi.mocked(repo.findAccountStatus).mockResolvedValueOnce({ userStatus: 'active', dealerStatus: 'active', dealerId: 'dealer-1' });
    await assertAccountActive('u-1', 1_000);
    invalidateAccountStatus('u-1');
    vi.mocked(repo.findAccountStatus).mockResolvedValueOnce({ userStatus: 'inactive', dealerStatus: 'active', dealerId: 'dealer-1' });
    await expect(assertAccountActive('u-1', 2_000)).rejects.toMatchObject({ code: 'account_blocked' });
  });
});

describe('dealer staff — scope, invites, updates, status', () => {
  it("a dealer_manager gets 404 (not 403) for another dealer's staff; admins may see any", async () => {
    await expect(listStaff(manager, 'dealer-2')).rejects.toMatchObject({ code: 'dealer_not_found' });
    vi.mocked(repo.listUsersByDealer).mockResolvedValue([staffRow] as never);
    await expect(listStaff(coAdmin, 'dealer-1')).resolves.toHaveLength(1);
    await expect(listStaff(manager, 'dealer-1')).resolves.toHaveLength(1);
  });

  it('invite creates an OTP-only user under the dealer and refuses a taken mobile', async () => {
    vi.mocked(repo.findUserByMobile).mockResolvedValueOnce(undefined);
    const created = await inviteStaff(manager, 'dealer-1', { name: 'Ravi', mobile: '9876543211', role: 'dealer_user' });
    expect(repo.insertUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scope: 'dealer', dealerId: 'dealer-1', mobile: '9876543211', role: 'dealer_user', createdBy: 'mgr-1' }));
    expect(repo.insertUser).toHaveBeenCalledWith(expect.anything(), expect.not.objectContaining({ passwordHash: expect.anything() }));
    expect(JSON.stringify(created)).not.toContain('SECRET');
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'user.created' }));

    vi.mocked(repo.findUserByMobile).mockResolvedValueOnce(staffRow as never);
    await expect(inviteStaff(manager, 'dealer-1', { name: 'Ravi', mobile: '9876543211', role: 'dealer_user' })).rejects.toMatchObject({ code: 'identifier_taken', field: 'mobile' });
  });

  it('a manager cannot change their own role', async () => {
    vi.mocked(repo.findUserById).mockResolvedValue({ ...staffRow, id: 'mgr-1', role: 'dealer_manager' } as never);
    await expect(updateStaff(manager, 'dealer-1', 'mgr-1', { role: 'dealer_user' })).rejects.toMatchObject({ code: 'cannot_change_own_role' });
  });

  it('extra grants are bounded by what the grantor holds', async () => {
    vi.mocked(repo.findUserById).mockResolvedValue(staffRow as never);
    await expect(updateStaff(manager, 'dealer-1', 'staff-1', { permissions: ['entries.read', 'dealers.approve'] })).rejects.toMatchObject({ code: 'grant_exceeds_grantor' });
    expect(repo.replaceGrants).not.toHaveBeenCalled();

    await updateStaff(manager, 'dealer-1', 'staff-1', { name: 'Ravi K', permissions: ['entries.read'] });
    expect(repo.replaceGrants).toHaveBeenCalledWith(expect.anything(), 'staff-1', 'mgr-1', ['entries.read']);
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'user.permission_granted', after: { permissions: ['entries.read'] } }));
  });

  it('blocking a staff member revokes their sessions and follows the state machine', async () => {
    vi.mocked(repo.findUserById).mockResolvedValue(staffRow as never);
    const result = await setStaffStatus(manager, 'dealer-1', 'staff-1', { status: 'temporarily_blocked', reason: 'Left the shop for a month' });
    expect(result.status).toBe('temporarily_blocked');
    expect(revokeAllSessionsForUser).toHaveBeenCalledWith(expect.anything(), 'staff-1', 'status_temporarily_blocked');
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'user.status_changed', reason: 'Left the shop for a month' }));

    vi.mocked(repo.findUserById).mockResolvedValue({ ...staffRow, status: 'soft_deleted' } as never);
    await expect(setStaffStatus(manager, 'dealer-1', 'staff-1', { status: 'active', reason: 'Back again' })).rejects.toMatchObject({ code: 'invalid_transition' });

    vi.mocked(repo.findUserById).mockResolvedValue({ ...staffRow, id: 'mgr-1' } as never);
    await expect(setStaffStatus(manager, 'dealer-1', 'mgr-1', { status: 'inactive', reason: 'Leaving myself' })).rejects.toMatchObject({ code: 'cannot_change_own_status' });

    vi.mocked(repo.findUserById).mockResolvedValue({ ...staffRow, dealerId: 'dealer-2' } as never);
    await expect(setStaffStatus(coAdmin, 'dealer-1', 'staff-1', { status: 'inactive', reason: 'Wrong shop' })).rejects.toMatchObject({ code: 'user_not_found' });
  });
});

describe('admin accounts — escalation and the last main admin', () => {
  it('creates an admin with a hashed password and email 2FA; never echoes the hash', async () => {
    vi.mocked(repo.findRoleByKey).mockResolvedValue({ key: 'operations', scope: 'admin' } as never);
    vi.mocked(repo.findUserByEmail).mockResolvedValue(undefined);
    const created = await createAdmin(mainAdmin, { name: 'New Ops', email: 'ops2@example.com', role: 'operations', password: 'longenough1' });
    expect(repo.insertUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scope: 'admin', passwordHash: 'hashed:longenough1', mfa: 'email_otp', role: 'operations' }));
    expect(JSON.stringify(created)).not.toContain('hashed:');
  });

  it('refuses a dealer role, a taken email, and main_admin creation by anyone but a main admin', async () => {
    vi.mocked(repo.findRoleByKey).mockResolvedValueOnce({ key: 'dealer_user', scope: 'dealer' } as never);
    await expect(createAdmin(mainAdmin, { name: 'X', email: 'x@example.com', role: 'dealer_user', password: 'longenough1' })).rejects.toMatchObject({ code: 'role_invalid' });

    vi.mocked(repo.findRoleByKey).mockResolvedValueOnce({ key: 'main_admin', scope: 'admin' } as never);
    await expect(createAdmin(coAdmin, { name: 'X', email: 'x@example.com', role: 'main_admin', password: 'longenough1' })).rejects.toMatchObject({ code: 'escalation_denied' });

    vi.mocked(repo.findRoleByKey).mockResolvedValueOnce({ key: 'operations', scope: 'admin' } as never);
    vi.mocked(repo.findUserByEmail).mockResolvedValueOnce({ id: 'someone' } as never);
    await expect(createAdmin(mainAdmin, { name: 'X', email: 'ops@example.com', role: 'operations', password: 'longenough1' })).rejects.toMatchObject({ code: 'identifier_taken', field: 'email' });
  });

  it('the last active main admin can neither be demoted nor deactivated', async () => {
    vi.mocked(repo.findUserById).mockResolvedValue({ ...staffRow, id: 'admin-9', scope: 'admin', dealerId: null, role: 'main_admin', status: 'active' } as never);
    vi.mocked(repo.findRoleByKey).mockResolvedValue({ key: 'co_admin', scope: 'admin' } as never);
    vi.mocked(repo.countActiveMainAdmins).mockResolvedValue(1);

    await expect(updateAdmin(mainAdmin, 'admin-9', { role: 'co_admin' })).rejects.toMatchObject({ code: 'last_main_admin' });
    await expect(setAdminStatus(mainAdmin, 'admin-9', { status: 'inactive', reason: 'Retired from the company' })).rejects.toMatchObject({ code: 'last_main_admin' });

    vi.mocked(repo.countActiveMainAdmins).mockResolvedValue(2);
    await expect(setAdminStatus(mainAdmin, 'admin-9', { status: 'inactive', reason: 'Retired from the company' })).resolves.toMatchObject({ status: 'inactive' });
  });

  it('a main admin cannot change their own role; a dealer user is not an admin', async () => {
    vi.mocked(repo.findUserById).mockResolvedValueOnce({ ...staffRow, id: 'admin-1', scope: 'admin', dealerId: null, role: 'main_admin' } as never);
    await expect(updateAdmin(mainAdmin, 'admin-1', { role: 'co_admin' })).rejects.toMatchObject({ code: 'cannot_change_own_role' });

    vi.mocked(repo.findUserById).mockResolvedValueOnce(staffRow as never);
    await expect(updateAdmin(mainAdmin, 'staff-1', { name: 'x' })).rejects.toMatchObject({ code: 'user_not_found' });
  });
});
