import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({
  db: {},
  withTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('../../utils/audit', () => ({ audit: vi.fn() }));
vi.mock('../../utils/ids', () => ({
  nextFormattedRef: vi.fn(async (_tx: unknown, prefix: string) => `${prefix}-26-09-0001`),
  monthKey: vi.fn(() => '26-09'),
}));
vi.mock('../../utils/settings', () => ({ readSetting: vi.fn(async (_db: unknown, _k: string, fallback: unknown) => fallback) }));

vi.mock('../batteries/batteries.repository', () => ({
  listModels: vi.fn(async () => [{ id: 'M1000' }, { id: 'S1500' }]),
  findBatteryByCode: vi.fn(),
  findChainById: vi.fn(),
}));

vi.mock('./warranty.repository', () => ({
  findOverrideById: vi.fn(),
  findPendingForChain: vi.fn(async () => undefined),
  insertOverride: vi.fn(async (_tx: unknown, input: object) => ({ id: 'ovr-1', status: 'pending', ...input })),
  updateOverrideDecision: vi.fn(async (_tx: unknown, id: string, input: object) => ({ id, ...input })),
  extendChainExpiry: vi.fn(),
  listOverrides: vi.fn(async () => ({ items: [] })),
}));

import { audit } from '../../utils/audit';
import * as batteriesRepo from '../batteries/batteries.repository';
import * as repo from './warranty.repository';
import { approveOverride, listOverrides, rejectOverride, requestOverride } from './warranty.service';
import type { Ctx } from '../../utils/context';

const now = () => new Date('2026-09-26T10:00:00Z');
const base = { request: { id: 'req-1', ip: '127.0.0.1', deviceId: 'd', userAgent: 'vitest' }, now };
const dealerCtx: Ctx = { ...base, user: { id: 'user-1', scope: 'dealer', role: 'dealer_manager', dealerId: 'dealer-1' } };
const adminCtx: Ctx = { ...base, user: { id: 'admin-1', scope: 'admin', role: 'main_admin' } };
const anonCtx: Ctx = { ...base, user: null };

const battery = { id: 'batt-1', batteryCode: 'M100024010001', modelId: 'M1000', chainId: 'chain-1', dealerId: 'dealer-1' };
const ask = { batteryCode: 'M1000 2401 0001', days: 30, reason: 'Customer is a long-standing fleet account' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findPendingForChain).mockResolvedValue(undefined as never);
  vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue(battery as never);
});

describe('requestOverride', () => {
  it('records the request against the battery that was scanned, by its full identity', async () => {
    const result = await requestOverride(dealerCtx, ask);

    expect(batteriesRepo.findBatteryByCode).toHaveBeenCalledWith(expect.anything(), 'M100024010001');
    expect(result).toMatchObject({ ref: 'OVR-26-09-0001', chainId: 'chain-1', batteryId: 'batt-1', dealerId: 'dealer-1', days: 30, status: 'pending' });
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'warranty.override_requested', entityRef: 'OVR-26-09-0001' }));
  });

  it('refuses more days than head office allows', async () => {
    await expect(requestOverride(dealerCtx, { ...ask, days: 400 })).rejects.toMatchObject({ code: 'override_too_long', field: 'days' });
    expect(repo.insertOverride).not.toHaveBeenCalled();
  });

  it('refuses a battery that is not on record — there is no chain to extend', async () => {
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue(undefined as never);
    await expect(requestOverride(dealerCtx, ask)).rejects.toMatchObject({ code: 'battery_not_on_record' });

    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue({ ...battery, chainId: null } as never);
    await expect(requestOverride(dealerCtx, ask)).rejects.toMatchObject({ code: 'battery_not_on_record' });
  });

  it("refuses another dealer's battery, and a code that names no product", async () => {
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue({ ...battery, dealerId: 'dealer-9' } as never);
    await expect(requestOverride(dealerCtx, ask)).rejects.toMatchObject({ code: 'custody_conflict' });

    await expect(requestOverride(dealerCtx, { ...ask, batteryCode: '24010001' })).rejects.toMatchObject({ code: 'model_required' });
    await expect(requestOverride(dealerCtx, { ...ask, batteryCode: 'M1000 2413 0001' })).rejects.toMatchObject({ code: 'format_mismatch' });
  });

  it('allows only one request in flight per chain', async () => {
    vi.mocked(repo.findPendingForChain).mockResolvedValue({ id: 'ovr-0', ref: 'OVR-26-09-0000' } as never);
    await expect(requestOverride(dealerCtx, ask)).rejects.toMatchObject({ code: 'override_already_requested' });
  });

  it('needs a signed-in caller', async () => {
    await expect(requestOverride(anonCtx, ask)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('approve / reject', () => {
  beforeEach(() => {
    vi.mocked(repo.findOverrideById).mockResolvedValue({ id: 'ovr-1', ref: 'OVR-26-09-0001', chainId: 'chain-1', days: 30, status: 'pending' } as never);
    vi.mocked(batteriesRepo.findChainById).mockResolvedValue({ id: 'chain-1', warrantyExpiry: '2026-03-31' } as never);
  });

  it('approving moves the chain expiry by exactly the days asked for, and keeps what it was', async () => {
    const result = await approveOverride(adminCtx, 'ovr-1', { reason: 'Approved as goodwill, fleet customer' });

    expect(repo.extendChainExpiry).toHaveBeenCalledWith(expect.anything(), 'chain-1', { expiryBefore: '2026-03-31', expiryAfter: '2026-04-30' });
    expect(result).toMatchObject({ status: 'approved', decidedBy: 'admin-1', expiryBefore: '2026-03-31', expiryAfter: '2026-04-30' });
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'warranty.override_approved',
      before: { warrantyExpiry: '2026-03-31' },
      after: { warrantyExpiry: '2026-04-30', days: 30 },
    }));
  });

  it('rejecting leaves the chain alone', async () => {
    const result = await rejectOverride(adminCtx, 'ovr-1', { reason: 'Cover ended more than a year ago' });
    expect(repo.extendChainExpiry).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'rejected', decidedBy: 'admin-1' });
  });

  it('a dealer cannot decide their own request', async () => {
    await expect(approveOverride(dealerCtx, 'ovr-1', { reason: 'Please allow this one' })).rejects.toMatchObject({ code: 'permission_denied' });
    expect(repo.extendChainExpiry).not.toHaveBeenCalled();
  });

  it('a request can only be decided once', async () => {
    vi.mocked(repo.findOverrideById).mockResolvedValue({ id: 'ovr-1', status: 'approved' } as never);
    await expect(approveOverride(adminCtx, 'ovr-1', { reason: 'Again please' })).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(rejectOverride(adminCtx, 'ovr-1', { reason: 'Again please' })).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('404s an unknown request', async () => {
    vi.mocked(repo.findOverrideById).mockResolvedValue(undefined as never);
    await expect(approveOverride(adminCtx, 'ovr-9', { reason: 'Whatever' })).rejects.toMatchObject({ code: 'override_not_found' });
  });
});

describe('listOverrides', () => {
  it('a dealer only ever sees their own requests', async () => {
    await listOverrides(dealerCtx, { limit: 50 });
    expect(repo.listOverrides).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: 'dealer-1' }));

    await listOverrides(adminCtx, { limit: 50, status: 'pending' });
    expect(repo.listOverrides).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ dealerId: undefined, status: 'pending' }));
  });
});
