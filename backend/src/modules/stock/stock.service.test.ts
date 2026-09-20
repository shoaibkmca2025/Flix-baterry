import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({
  db: {},
  withTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('../../utils/audit', () => ({ audit: vi.fn() }));

vi.mock('../batteries/batteries.repository', () => ({
  findBatteryByCode: vi.fn(),
  applyMovement: vi.fn(async (_tx: unknown, id: string, input: object) => ({ id, ...input })),
}));

vi.mock('./stock.repository', () => ({
  insertMovement: vi.fn(async (_tx: unknown, input: object) => ({ id: 'mv-1', ...input })),
  findMovementById: vi.fn(),
  listMovements: vi.fn(),
  positionsBy: vi.fn(),
}));

import { audit } from '../../utils/audit';
import * as batteriesRepo from '../batteries/batteries.repository';
import * as repo from './stock.repository';
import { ledger, positions, postMovement, postMovementInTx } from './stock.service';
import type { Ctx } from '../../utils/context';

const now = () => new Date('2026-09-19T10:00:00Z');
const base = { request: { id: 'req-1', ip: '127.0.0.1', deviceId: 'device-1', userAgent: 'vitest' }, now };
const adminCtx: Ctx = { ...base, user: { id: 'admin-1', scope: 'admin', role: 'main_admin' } };
const dealerCtx: Ctx = { ...base, user: { id: 'user-1', scope: 'dealer', role: 'dealer_manager', dealerId: 'dealer-1' } };
const anonCtx: Ctx = { ...base, user: null };

const sold = { id: 'batt-1', batteryCode: '26041212', state: 'sold', custodian: 'customer', dealerId: 'dealer-1' } as const;

beforeEach(() => vi.clearAllMocks());

describe('postMovementInTx — the single writer of battery state', () => {
  it('appends the ledger row with from/to snapshots and applies it to the battery', async () => {
    const result = await postMovementInTx({} as never, adminCtx, { battery: sold, toState: 'returned', toCustodian: 'dealer', entryId: 'ent-1', reasonCode: 'entry_approved' });

    expect(repo.insertMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      batteryId: 'batt-1', fromState: 'sold', toState: 'returned', fromCustodian: 'customer', toCustodian: 'dealer',
      fromDealerId: 'dealer-1', toDealerId: 'dealer-1', entryId: 'ent-1', reasonCode: 'entry_approved', postedBy: 'admin-1', postedAt: now(),
    }));
    expect(batteriesRepo.applyMovement).toHaveBeenCalledWith(expect.anything(), 'batt-1', { state: 'returned', custodian: 'dealer', dealerId: 'dealer-1' });
    expect(result.battery).toMatchObject({ state: 'returned' });
  });

  it('a creation movement (battery: null) records from = null and does not touch the row', async () => {
    const result = await postMovementInTx({} as never, adminCtx, { battery: null, batteryId: 'new-1', toState: 'replacement', toCustodian: 'customer', toDealerId: 'dealer-1', reasonCode: 'entry_approved' });
    expect(repo.insertMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ batteryId: 'new-1', fromState: null, fromCustodian: null, fromDealerId: null, toDealerId: 'dealer-1' }));
    expect(batteriesRepo.applyMovement).not.toHaveBeenCalled();
    expect(result.battery).toBeNull();
  });

  it('refuses an illegal transition before writing anything', async () => {
    await expect(postMovementInTx({} as never, adminCtx, { battery: sold, toState: 'scrap', toCustodian: 'company', reasonCode: 'manual' })).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(repo.insertMovement).not.toHaveBeenCalled();
  });

  it('scrap is terminal — a distinct error so the UI can suggest a correction', async () => {
    await expect(postMovementInTx({} as never, adminCtx, { battery: { ...sold, state: 'scrap' }, toState: 'repair', toCustodian: 'company', reasonCode: 'manual' })).rejects.toMatchObject({ code: 'scrap_is_terminal' });
  });

  it('toDealerId: null clears the dealer (battery back at the company); undefined keeps it', async () => {
    await postMovementInTx({} as never, adminCtx, { battery: { ...sold, state: 'returned', custodian: 'transit' }, toState: 'returned', toCustodian: 'company', toDealerId: null, reasonCode: 'claim_received' });
    expect(batteriesRepo.applyMovement).toHaveBeenLastCalledWith(expect.anything(), 'batt-1', expect.objectContaining({ dealerId: null }));

    await postMovementInTx({} as never, adminCtx, { battery: { ...sold, state: 'returned' }, toState: 'returned', toCustodian: 'transit', reasonCode: 'claim_dispatched' });
    expect(batteriesRepo.applyMovement).toHaveBeenLastCalledWith(expect.anything(), 'batt-1', expect.objectContaining({ dealerId: 'dealer-1' }));
  });

  it('a system job (no user) posts with postedBy null', async () => {
    await postMovementInTx({} as never, anonCtx, { battery: sold, toState: 'returned', toCustodian: 'dealer', reasonCode: 'manual' });
    expect(repo.insertMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ postedBy: null }));
  });
});

describe('postMovement — admin manual post', () => {
  it('is admin-only', async () => {
    await expect(postMovement(dealerCtx, { batteryCode: '26041212', toState: 'returned', reasonText: 'Counted at shop' })).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(postMovement(anonCtx, { batteryCode: '26041212', toState: 'returned', reasonText: 'Counted at shop' })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('404s an unknown code (normalised first) and audits a successful post', async () => {
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValueOnce(undefined);
    await expect(postMovement(adminCtx, { batteryCode: ' 2604 1212 ', toState: 'returned', reasonText: 'Brought back by hand' })).rejects.toMatchObject({ code: 'battery_not_found' });
    expect(batteriesRepo.findBatteryByCode).toHaveBeenCalledWith(expect.anything(), '26041212');

    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValueOnce(sold as never);
    const result = await postMovement(adminCtx, { batteryCode: '26041212', toState: 'returned', toCustodian: 'dealer', reasonText: 'Brought back by hand' });

    expect(result.movement).toMatchObject({ reasonCode: 'manual', reasonText: 'Brought back by hand' });
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'stock.movement_posted', entityRef: '26041212', before: { state: 'sold', custodian: 'customer', dealerId: 'dealer-1' } }));
  });

  it('a correction must point at a movement on the same battery, and is tagged as such', async () => {
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue(sold as never);
    vi.mocked(repo.findMovementById).mockResolvedValueOnce({ id: 'mv-9', batteryId: 'other' } as never);
    await expect(postMovement(adminCtx, { batteryCode: '26041212', toState: 'returned', reasonText: 'Undo wrong post', correctionOfId: '0b6d1e1e-7d1a-4b6c-9f8e-2f4a1c3d5e6f' })).rejects.toMatchObject({ code: 'movement_not_found' });

    vi.mocked(repo.findMovementById).mockResolvedValueOnce({ id: 'mv-9', batteryId: 'batt-1' } as never);
    const result = await postMovement(adminCtx, { batteryCode: '26041212', toState: 'returned', reasonText: 'Undo wrong post', correctionOfId: '0b6d1e1e-7d1a-4b6c-9f8e-2f4a1c3d5e6f' });
    expect(result.movement).toMatchObject({ reasonCode: 'correction', correctionOfId: '0b6d1e1e-7d1a-4b6c-9f8e-2f4a1c3d5e6f' });
  });
});

describe('ledger / positions — dealer scope is always the token, never the query', () => {
  it('ledger forces the dealer filter for a dealer and resolves a code to an id', async () => {
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue(sold as never);
    vi.mocked(repo.listMovements).mockResolvedValue({ items: [], nextCursor: null });
    await ledger(dealerCtx, { batteryCode: '26041212', dealerId: 'someone-else', limit: 50 });
    expect(repo.listMovements).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ batteryId: 'batt-1', dealerId: 'dealer-1' }));
  });

  it('ledger for an unknown code is simply empty', async () => {
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue(undefined);
    await expect(ledger(adminCtx, { batteryCode: '99999999', limit: 50 })).resolves.toEqual({ items: [], nextCursor: null });
    expect(repo.listMovements).not.toHaveBeenCalled();
  });

  it('positions total the derived counts; a dealer only sees their own', async () => {
    vi.mocked(repo.positionsBy).mockResolvedValue([{ key: 'sold', state: 'sold', count: 3 }, { key: 'returned', state: 'returned', count: 2 }]);
    const result = await positions(dealerCtx, { by: 'state', dealerId: 'someone-else' });
    expect(repo.positionsBy).toHaveBeenCalledWith(expect.anything(), 'state', 'dealer-1');
    expect(result).toMatchObject({ total: 5, dealerId: 'dealer-1' });
  });

  it('rejects a malformed cursor', async () => {
    await expect(ledger(adminCtx, { limit: 50, cursor: '!!' })).rejects.toMatchObject({ code: 'filter_invalid' });
  });
});
