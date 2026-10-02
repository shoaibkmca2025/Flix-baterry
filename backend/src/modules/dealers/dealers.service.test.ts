import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({
  db: {},
  withTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('../../utils/audit', () => ({ audit: vi.fn() }));

vi.mock('../auth/auth.tokens', () => ({
  verifyVerifiedToken: vi.fn(),
}));

vi.mock('../auth/auth.repository', () => ({
  revokeAllSessionsForUser: vi.fn(),
}));

vi.mock('./dealers.repository', () => ({
  findDealerByMobile: vi.fn(),
  findDealerById: vi.fn(),
  findDealerByCode: vi.fn(),
  findUsersByDealerId: vi.fn(),
  insertDealer: vi.fn(),
  insertDealerUser: vi.fn(),
  updateDealerStatus: vi.fn(),
  updateDealerProfile: vi.fn(),
  listDealers: vi.fn(),
  findDealersByDistributor: vi.fn(async () => []),
}));

vi.mock('../users/users.repository', () => ({ findUserByMobile: vi.fn() }));

vi.mock('../masters/masters.repository', () => ({
  findCityByName: vi.fn(),
}));

import * as repo from './dealers.repository';
import { findCityByName } from '../masters/masters.repository';
import { revokeAllSessionsForUser } from '../auth/auth.repository';
import { verifyVerifiedToken } from '../auth/auth.tokens';
import { activate, approve, createMyDealer, distributorShopIds, getById, getMe, list, listMyDealers, register, reject, setMyDealerStatus, suspend } from './dealers.service';
import { findUserByMobile } from '../users/users.repository';
import { AppError } from '../../utils/errors';
import type { Ctx } from '../../utils/context';

const adminCtx: Ctx = {
  user: { id: 'admin-1', scope: 'admin', role: 'main_admin' },
  request: { id: 'req-2', ip: '127.0.0.1', deviceId: 'device-1', userAgent: 'vitest' },
  now: () => new Date('2026-09-16T10:00:00Z'),
};

const ctx: Ctx = {
  user: null,
  request: { id: 'req-1', ip: '127.0.0.1', deviceId: 'device-1', userAgent: 'vitest' },
  now: () => new Date('2026-09-16T10:00:00Z'),
};

const validInput = {
  verifiedToken: 'tok-1',
  name: 'Felix Power Point',
  contactPerson: 'Suresh Patil',
  mobile: '9876543210',
  email: '',
  city: 'Dhule',
  state: 'Maharashtra',
  pin: '424001',
  place: 'Sakri Road',
  address: 'Shop 4, Sakri Road',
  password: 'a-strong-password',
};

beforeEach(() => vi.clearAllMocks());

describe('register', () => {
  it('rejects when the verifiedToken does not match the submitted mobile', async () => {
    vi.mocked(verifyVerifiedToken).mockResolvedValue({ purpose: 'register', target: '9999999999' });

    await expect(register(ctx, validInput)).rejects.toThrow('does not match');
  });

  it('rejects a mobile already registered', async () => {
    vi.mocked(verifyVerifiedToken).mockResolvedValue({ purpose: 'register', target: validInput.mobile });
    vi.mocked(repo.findDealerByMobile).mockResolvedValue({ id: 'dealer-existing' } as never);

    await expect(register(ctx, validInput)).rejects.toThrow(AppError);
    await expect(register(ctx, validInput)).rejects.toMatchObject({ code: 'mobile_taken' });
  });

  it('rejects a city not in the master list', async () => {
    vi.mocked(verifyVerifiedToken).mockResolvedValue({ purpose: 'register', target: validInput.mobile });
    vi.mocked(repo.findDealerByMobile).mockResolvedValue(undefined);
    vi.mocked(findCityByName).mockResolvedValue(undefined);

    await expect(register(ctx, validInput)).rejects.toMatchObject({ code: 'city_invalid' });
  });

  it('creates the dealer as pending_approval on a valid submission', async () => {
    vi.mocked(verifyVerifiedToken).mockResolvedValue({ purpose: 'register', target: validInput.mobile });
    vi.mocked(repo.findDealerByMobile).mockResolvedValue(undefined);
    vi.mocked(findCityByName).mockResolvedValue({ id: 'city-1', name: 'Dhule' } as never);
    vi.mocked(repo.insertDealer).mockResolvedValue({ id: 'dealer-1', name: validInput.name, status: 'pending_approval' } as never);
    vi.mocked(repo.insertDealerUser).mockResolvedValue({ id: 'user-1' } as never);

    const result = await register(ctx, validInput);

    expect(result).toEqual({ id: 'dealer-1', name: validInput.name, status: 'pending_approval' });
    expect(repo.insertDealer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mobile: validInput.mobile, cityId: 'city-1' }));
    expect(repo.insertDealerUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: 'dealer-1' }));
  });
});

describe('getMe', () => {
  it('rejects a signed-in admin with 403, not 401 (a 401 would sign them out)', async () => {
    await expect(getMe(adminCtx)).rejects.toMatchObject({ code: 'dealer_only', status: 403 });
  });

  it('rejects an anonymous caller with 401', async () => {
    await expect(getMe(ctx)).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
  });

  it('returns the dealer for a signed-in dealer user', async () => {
    const dealerCtx: Ctx = { ...ctx, user: { id: 'user-1', scope: 'dealer', role: 'dealer_manager', dealerId: 'dealer-1' } };
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'dealer-1', name: 'Felix Power Point' } as never);

    const result = await getMe(dealerCtx);

    expect(result).toMatchObject({ id: 'dealer-1' });
  });
});

describe('approve', () => {
  it('rejects a non-admin caller', async () => {
    await expect(approve(ctx, 'dealer-1', { dealerCode: 'FPP-014', reason: 'looks good' })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects approving a dealer that is already active', async () => {
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'dealer-1', status: 'active', dealerCode: 'FPP-014' } as never);

    await expect(approve(adminCtx, 'dealer-1', { dealerCode: 'FPP-014', reason: 'looks good' })).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('rejects a dealer code already used by someone else', async () => {
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'dealer-1', status: 'pending_approval', dealerCode: null } as never);
    vi.mocked(repo.findDealerByCode).mockResolvedValue({ id: 'dealer-2' } as never);

    await expect(approve(adminCtx, 'dealer-1', { dealerCode: 'FPP-014', reason: 'looks good' })).rejects.toMatchObject({ code: 'dealer_code_taken' });
  });

  it('approves a pending dealer and assigns the code', async () => {
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'dealer-1', status: 'pending_approval', dealerCode: null, name: 'Felix Power Point' } as never);
    vi.mocked(repo.findDealerByCode).mockResolvedValue(undefined);
    vi.mocked(repo.updateDealerStatus).mockResolvedValue({ id: 'dealer-1', status: 'active', dealerCode: 'FPP-014' } as never);

    const result = await approve(adminCtx, 'dealer-1', { dealerCode: 'FPP-014', reason: 'looks good' });

    expect(result).toMatchObject({ status: 'active', dealerCode: 'FPP-014' });
    expect(repo.updateDealerStatus).toHaveBeenCalledWith(expect.anything(), 'dealer-1', expect.objectContaining({ status: 'active', dealerCode: 'FPP-014' }));
  });
});

describe('reject', () => {
  it('only allows rejecting a pending dealer', async () => {
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'dealer-1', status: 'active' } as never);
    await expect(reject(adminCtx, 'dealer-1', { reason: 'not eligible' })).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});

describe('suspend', () => {
  it('only allows suspending an active dealer', async () => {
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'dealer-1', status: 'pending_approval' } as never);
    await expect(suspend(adminCtx, 'dealer-1', { reason: 'GST mismatch' })).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('revokes every session for the dealer\'s users so suspension takes effect immediately', async () => {
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'dealer-1', status: 'active', name: 'Felix Power Point' } as never);
    vi.mocked(repo.updateDealerStatus).mockResolvedValue({ id: 'dealer-1', status: 'suspended' } as never);
    vi.mocked(repo.findUsersByDealerId).mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }] as never);

    await suspend(adminCtx, 'dealer-1', { reason: 'GST mismatch' });

    expect(revokeAllSessionsForUser).toHaveBeenCalledTimes(2);
    expect(revokeAllSessionsForUser).toHaveBeenCalledWith(expect.anything(), 'user-1', 'dealer_suspended');
  });
});

describe('activate', () => {
  it('only allows activating a suspended dealer', async () => {
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'dealer-1', status: 'active' } as never);
    await expect(activate(adminCtx, 'dealer-1', { reason: 'issue resolved' })).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});

describe('list / getById', () => {
  it('rejects a non-admin caller for both', async () => {
    await expect(list(ctx, { limit: 50 })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(getById(ctx, 'dealer-1')).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('returns items and nextCursor for an admin', async () => {
    vi.mocked(repo.listDealers).mockResolvedValue({ items: [{ id: 'dealer-1' }], nextCursor: null } as never);
    const result = await list(adminCtx, { limit: 50 });
    expect(result.items).toHaveLength(1);
  });
});

describe("a distributor's own dealers (head office → distributor → dealer)", () => {
  const distCtx: Ctx = { ...adminCtx, user: { id: 'user-d', scope: 'dealer', role: 'dealer_manager', dealerId: 'dist-1' } };
  const dealerUserCtx: Ctx = { ...adminCtx, user: { id: 'user-x', scope: 'dealer', role: 'dealer_manager', dealerId: 'shop-1' } };
  const distributor = { id: 'dist-1', name: 'Felix Factory', kind: 'distributor', distributorId: null, status: 'active' };
  const childInput = { name: 'Patil Batteries', contactPerson: 'Ravi Patil', mobile: '9822001122', email: '', city: 'Nashik', state: 'Maharashtra', pin: '422001', address: 'Main Road' };

  it('creates the dealer under him, active at once, with a user who signs in by mobile code', async () => {
    vi.mocked(repo.findDealerById).mockResolvedValue(distributor as never);
    vi.mocked(repo.findDealerByMobile).mockResolvedValue(undefined as never);
    vi.mocked(findUserByMobile).mockResolvedValue(undefined as never);
    vi.mocked(findCityByName).mockResolvedValue({ id: 'city-nsk' } as never);
    vi.mocked(repo.insertDealer).mockResolvedValue({ id: 'shop-1', name: 'Patil Batteries' } as never);

    await createMyDealer(distCtx, childInput);

    expect(repo.insertDealer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'dealer', distributorId: 'dist-1', status: 'active', registeredVia: 'distributor', mobile: '9822001122', cityId: 'city-nsk' }));
    expect(repo.insertDealerUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: 'shop-1', mobile: '9822001122', passwordHash: null }));
  });

  it('refuses a mobile number that already has an account', async () => {
    vi.mocked(repo.findDealerById).mockResolvedValue(distributor as never);
    vi.mocked(repo.findDealerByMobile).mockResolvedValue(undefined as never);
    vi.mocked(findUserByMobile).mockResolvedValue({ id: 'someone' } as never);
    await expect(createMyDealer(distCtx, childInput)).rejects.toMatchObject({ code: 'mobile_taken', status: 409 });
    expect(repo.insertDealer).not.toHaveBeenCalled();
  });

  it('only a distributor can add or list dealers — a dealer cannot', async () => {
    vi.mocked(repo.findDealerById).mockResolvedValue({ id: 'shop-1', kind: 'dealer', distributorId: 'dist-1' } as never);
    await expect(createMyDealer(dealerUserCtx, childInput)).rejects.toMatchObject({ code: 'distributor_only', status: 403 });
    await expect(listMyDealers(dealerUserCtx)).rejects.toMatchObject({ code: 'distributor_only' });
    await expect(createMyDealer(adminCtx, childInput)).rejects.toMatchObject({ status: 403 });
  });

  it("suspends only his own dealers, and signs them out", async () => {
    vi.mocked(repo.findDealerById).mockImplementation(async (_db, id) => (id === 'dist-1' ? distributor : id === 'shop-1' ? { id: 'shop-1', name: 'Patil Batteries', kind: 'dealer', distributorId: 'dist-1', status: 'active' } : { id, kind: 'dealer', distributorId: 'dist-2', status: 'active' }) as never);
    vi.mocked(repo.findUsersByDealerId).mockResolvedValue([{ id: 'u-1' }] as never);
    vi.mocked(repo.updateDealerStatus).mockResolvedValue({ id: 'shop-1', status: 'suspended' } as never);

    await setMyDealerStatus(distCtx, 'shop-1', 'suspended', { reason: 'Shop closed for now' });
    expect(repo.updateDealerStatus).toHaveBeenCalledWith(expect.anything(), 'shop-1', expect.objectContaining({ status: 'suspended' }));
    expect(revokeAllSessionsForUser).toHaveBeenCalledWith(expect.anything(), 'u-1', 'dealer_suspended');

    await expect(setMyDealerStatus(distCtx, 'shop-9', 'suspended', { reason: 'Not mine at all' })).rejects.toMatchObject({ code: 'dealer_not_found', status: 404 });
  });

  it('acts for his own shop and every dealer under him', async () => {
    vi.mocked(repo.findDealerById).mockResolvedValue(distributor as never);
    vi.mocked(repo.findDealersByDistributor).mockResolvedValue([{ id: 'shop-1' }, { id: 'shop-2' }] as never);
    expect([...(await distributorShopIds(distCtx))]).toEqual(['dist-1', 'shop-1', 'shop-2']);
  });
});
