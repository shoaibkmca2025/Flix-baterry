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

vi.mock('../batteries/batteries.repository', () => ({
  findBatteryByCode: vi.fn(),
  findModelById: vi.fn(),
  findChainById: vi.fn(),
  insertBattery: vi.fn(),
  updateBatteryReplacedBy: vi.fn(),
  updateBatteryChainId: vi.fn(),
  insertChain: vi.fn(),
  incrementChainReplacementCount: vi.fn(),
  insertReplacementLink: vi.fn(),
}));

vi.mock('../claims/claims.repository', () => ({
  insertClaim: vi.fn(),
}));

vi.mock('../dealers/dealers.repository', () => ({
  findDealerById: vi.fn(async (_db: unknown, id: string) => (id === 'dealer-1' ? { id, status: 'active' } : id === 'dealer-suspended' ? { id, status: 'suspended' } : undefined)),
}));

vi.mock('../stock/stock.service', () => ({
  postMovementInTx: vi.fn(async (_tx: unknown, _ctx: unknown, input: { battery: { id: string } | null; batteryId?: string; toState: string; toCustodian: string }) => ({
    movement: { id: 'mv-1' },
    battery: input.battery ? { ...input.battery, state: input.toState, custodian: input.toCustodian } : null,
  })),
}));

vi.mock('./entries.repository', () => ({
  findEntryById: vi.fn(),
  findItemsByEntryId: vi.fn(),
  insertEntry: vi.fn(),
  insertEntryItem: vi.fn(),
  updateEntryItemLinks: vi.fn(),
  updateEntryStatus: vi.fn(),
  listEntries: vi.fn(),
}));

import * as batteriesRepo from '../batteries/batteries.repository';
import * as claimsRepo from '../claims/claims.repository';
import { postMovementInTx } from '../stock/stock.service';
import * as repo from './entries.repository';
import { approve, create, getById, list, reject } from './entries.service';
import type { Ctx } from '../../utils/context';
import type { EntryCreateBody } from './entries.validation';

const now = () => new Date('2026-09-17T10:00:00Z');
const dealerCtx: Ctx = {
  user: { id: 'user-1', scope: 'dealer', role: 'dealer_manager', dealerId: 'dealer-1' },
  request: { id: 'req-1', ip: '127.0.0.1', deviceId: 'device-1', userAgent: 'vitest' },
  now,
};
const otherDealerCtx: Ctx = { ...dealerCtx, user: { ...dealerCtx.user!, dealerId: 'dealer-2' } };
const adminCtx: Ctx = { ...dealerCtx, user: { id: 'admin-1', scope: 'admin', role: 'main_admin' } };
const anonCtx: Ctx = { ...dealerCtx, user: null };

function baseBody(overrides: Partial<EntryCreateBody> = {}): EntryCreateBody {
  return {
    entryType: 'regular_sales',
    place: 'Nashik',
    items: [{ modelId: 'M5', code: '26041212' }],
    coverTold: false,
    ...overrides,
  } as EntryCreateBody;
}

beforeEach(() => vi.clearAllMocks());

describe('create', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(create(anonCtx, baseBody())).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('head office must name an ACTIVE dealer; a dealer session ignores any dealerId sent', async () => {
    await expect(create(adminCtx, baseBody())).rejects.toMatchObject({ code: 'dealer_required', field: 'dealerId' });
    await expect(create(adminCtx, baseBody({ dealerId: 'dealer-suspended' }))).rejects.toMatchObject({ code: 'dealer_not_active' });
    await expect(create(adminCtx, baseBody({ dealerId: 'dealer-9' }))).rejects.toMatchObject({ code: 'dealer_not_found' });
    expect(repo.insertEntry).not.toHaveBeenCalled();
  });

  it('rejects a malformed battery code before opening a transaction', async () => {
    await expect(create(dealerCtx, baseBody({ items: [{ modelId: 'M5', code: '123' }] }))).rejects.toMatchObject({ code: 'format_mismatch' });
    expect(repo.insertEntry).not.toHaveBeenCalled();
  });

  it('rejects a replacement item whose old and new codes are the same', async () => {
    const body = baseBody({ entryType: 'replacement', items: [{ modelId: 'M5', code: '26041212', oldCode: '26041212', faultCode: 'not_holding_charge' }] });
    await expect(create(dealerCtx, body)).rejects.toMatchObject({ code: 'old_equals_new' });
  });

  it('rejects the same battery code appearing twice in one entry', async () => {
    const body = baseBody({ items: [{ modelId: 'M5', code: '26041212' }, { modelId: 'M5', code: '26041212' }] });
    await expect(create(dealerCtx, body)).rejects.toMatchObject({ code: 'duplicate_serial' });
  });

  it('inserts the entry and its items in one transaction, scoped to the caller dealer', async () => {
    vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-1', ref: 'ENT-26-09-0001' } as never);
    vi.mocked(repo.insertEntryItem).mockResolvedValue({ id: 'item-1' } as never);

    const result = await create(dealerCtx, baseBody());

    expect(result).toMatchObject({ id: 'entry-1', ref: 'ENT-26-09-0001' });
    expect(repo.insertEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: 'dealer-1', entryType: 'regular_sales', totalQty: 1 }));
    expect(repo.insertEntryItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entryId: 'entry-1', batteryCode: '26041212' }));
  });
});

describe('approve — regular_sales (first sale, opens a new chain)', () => {
  it('creates a battery and a fresh warranty chain anchored to the entry date', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ id: 'entry-1', ref: 'ENT-26-09-0001', status: 'submitted', dealerId: 'dealer-1', entryType: 'regular_sales', entryDate: '2026-09-17' } as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([
      { id: 'item-1', seq: 0, modelId: 'M5', batteryCode: '26041212', batteryCodeEntered: '26041212', oldBatteryCode: null },
    ] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue(undefined);
    vi.mocked(batteriesRepo.findModelById).mockResolvedValue({ id: 'M5', warrantyMonths: 24 } as never);
    vi.mocked(batteriesRepo.insertBattery).mockResolvedValue({ id: 'batt-1' } as never);
    vi.mocked(batteriesRepo.insertChain).mockResolvedValue({ id: 'chain-1' } as never);
    vi.mocked(batteriesRepo.updateBatteryChainId).mockResolvedValue({ id: 'batt-1', chainId: 'chain-1' } as never);
    vi.mocked(repo.updateEntryStatus).mockResolvedValue({ id: 'entry-1', status: 'approved' } as never);

    const result = await approve(adminCtx, 'entry-1', 'Looks good');

    expect(batteriesRepo.insertChain).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ rootBatteryId: 'batt-1', warrantyStart: '2026-09-17' }));
    expect(result.entry.status).toBe('approved');
  });

  it('refuses a battery code that is already registered', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ id: 'entry-1', status: 'submitted', dealerId: 'dealer-1', entryType: 'regular_sales', entryDate: '2026-09-17' } as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([{ id: 'item-1', seq: 0, modelId: 'M5', batteryCode: '26041212', batteryCodeEntered: '26041212' }] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue({ id: 'batt-existing' } as never);

    await expect(approve(adminCtx, 'entry-1', 'Looks good')).rejects.toMatchObject({ code: 'duplicate_serial' });
  });
});

describe('approve — replacement (inherits the old chain, raises a claim)', () => {
  const entry = { id: 'entry-1', ref: 'ENT-26-09-0002', status: 'submitted', dealerId: 'dealer-1', entryType: 'replacement', entryDate: '2026-09-17' };
  const item = { id: 'item-1', seq: 0, modelId: 'M5', batteryCode: '26090001', batteryCodeEntered: '26090001', oldBatteryCode: '26010099', oldBatteryCodeEntered: '26010099' };

  it('rejects an old battery that is not on record', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue(undefined);

    await expect(approve(adminCtx, 'entry-1', 'ok')).rejects.toMatchObject({ code: 'old_not_on_record' });
  });

  it('rejects an old battery belonging to a different dealer', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue({ id: 'old-1', chainId: 'chain-1', custodian: 'dealer', dealerId: 'dealer-2' } as never);

    await expect(approve(adminCtx, 'entry-1', 'ok')).rejects.toMatchObject({ code: 'custody_conflict' });
  });

  it('rejects a battery that has already been replaced once', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue({ id: 'old-1', chainId: 'chain-1', custodian: 'dealer', dealerId: 'dealer-1', replacedById: 'batt-already-new' } as never);

    await expect(approve(adminCtx, 'entry-1', 'ok')).rejects.toMatchObject({ code: 'already_replaced' });
  });

  it('rejects a replacement once the ORIGINAL chain has expired, even though the new battery is fresh', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValueOnce({ id: 'old-1', chainId: 'chain-1', custodian: 'dealer', dealerId: 'dealer-1', replacedById: null } as never);
    vi.mocked(batteriesRepo.findChainById).mockResolvedValue({ id: 'chain-1', warrantyStart: '2024-01-15', warrantyExpiry: '2026-01-14' } as never);

    await expect(approve(adminCtx, 'entry-1', 'ok')).rejects.toMatchObject({ code: 'warranty_expired' });
  });

  it('creates the new battery on the SAME chain, links the replacement, and raises a claim referencing both batteries', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(batteriesRepo.findBatteryByCode)
      .mockResolvedValueOnce({ id: 'old-1', chainId: 'chain-1', custodian: 'dealer', dealerId: 'dealer-1', replacedById: null } as never)
      .mockResolvedValueOnce(undefined); // new code not already registered
    vi.mocked(batteriesRepo.findChainById).mockResolvedValue({ id: 'chain-1', warrantyStart: '2026-01-15', warrantyExpiry: '2028-01-14', replacementCount: 0 } as never);
    vi.mocked(batteriesRepo.insertBattery).mockResolvedValue({ id: 'new-1' } as never);
    vi.mocked(claimsRepo.insertClaim).mockResolvedValue({ id: 'claim-1', ref: 'CLM-26-09-0001' } as never);
    vi.mocked(repo.updateEntryStatus).mockResolvedValue({ id: 'entry-1', status: 'approved' } as never);

    const result = await approve(adminCtx, 'entry-1', 'Confirmed replacement');

    expect(batteriesRepo.insertBattery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ chainId: 'chain-1', replacedFromId: 'old-1', state: 'replacement' }));
    expect(batteriesRepo.updateBatteryReplacedBy).toHaveBeenCalledWith(expect.anything(), 'old-1', 'new-1');
    // both sides of the swap are ledger movements: new battery created → replacement/customer, old → returned/dealer
    expect(postMovementInTx).toHaveBeenCalledWith(expect.anything(), adminCtx, expect.objectContaining({ battery: null, batteryId: 'new-1', toState: 'replacement', toCustodian: 'customer', entryId: 'entry-1', reasonCode: 'entry_approved' }));
    expect(postMovementInTx).toHaveBeenCalledWith(expect.anything(), adminCtx, expect.objectContaining({ battery: expect.objectContaining({ id: 'old-1' }), toState: 'returned', toCustodian: 'dealer', toDealerId: 'dealer-1' }));
    expect(claimsRepo.insertClaim).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ chainId: 'chain-1', oldBatteryId: 'old-1', newBatteryId: 'new-1' }));
    expect(result.items[0]).toMatchObject({ newBattery: { id: 'new-1' }, claim: { id: 'claim-1' } });
  });
});

describe('approve — sales_return', () => {
  it('marks an existing battery returned without touching replacedById', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ id: 'entry-1', status: 'submitted', dealerId: 'dealer-1', entryType: 'sales_return', entryDate: '2026-09-17' } as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([{ id: 'item-1', seq: 0, modelId: 'M5', batteryCode: '26041212', batteryCodeEntered: '26041212' }] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue({ id: 'batt-1', state: 'sold', custodian: 'customer', dealerId: 'dealer-1' } as never);
    vi.mocked(repo.updateEntryStatus).mockResolvedValue({ id: 'entry-1', status: 'approved' } as never);

    const result = await approve(adminCtx, 'entry-1', 'ok');

    expect(postMovementInTx).toHaveBeenCalledWith(expect.anything(), adminCtx, expect.objectContaining({ battery: expect.objectContaining({ id: 'batt-1' }), toState: 'returned', toCustodian: 'dealer', reasonCode: 'entry_approved' }));
    expect(result.items[0]).toMatchObject({ battery: { id: 'batt-1', state: 'returned' } });
    expect(batteriesRepo.updateBatteryReplacedBy).not.toHaveBeenCalled();
    expect(batteriesRepo.insertBattery).not.toHaveBeenCalled();
  });
});

describe('approve / reject — guards', () => {
  it('rejects a non-admin caller', async () => {
    await expect(approve(dealerCtx, 'entry-1', 'ok')).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects approving an entry that is not "submitted"', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ id: 'entry-1', status: 'approved' } as never);
    await expect(approve(adminCtx, 'entry-1', 'ok')).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('rejects an entry, recording who and why', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ id: 'entry-1', status: 'submitted' } as never);
    vi.mocked(repo.updateEntryStatus).mockResolvedValue({ id: 'entry-1', status: 'rejected' } as never);

    const result = await reject(adminCtx, 'entry-1', 'Photos unclear');

    expect(result.status).toBe('rejected');
    expect(repo.updateEntryStatus).toHaveBeenCalledWith(expect.anything(), 'entry-1', expect.objectContaining({ status: 'rejected', decidedBy: 'admin-1', decisionReason: 'Photos unclear' }));
  });
});

describe('getById — dealer scoping', () => {
  it('hides an entry belonging to another dealer behind a 404 (no existence leak)', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ id: 'entry-1', dealerId: 'dealer-1' } as never);
    await expect(getById(otherDealerCtx, 'entry-1')).rejects.toMatchObject({ code: 'entry_not_found' });
  });

  it("lets a dealer read their own entry", async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ id: 'entry-1', dealerId: 'dealer-1' } as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([] as never);

    const result = await getById(dealerCtx, 'entry-1');

    expect(result.id).toBe('entry-1');
  });
});

describe('list', () => {
  it("scopes a dealer caller to their own dealerId, ignoring what's asked", async () => {
    vi.mocked(repo.listEntries).mockResolvedValue({ items: [], nextCursor: null } as never);

    await list(dealerCtx, { limit: 50 });

    expect(repo.listEntries).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: 'dealer-1' }));
  });

  it('does not scope an admin caller to any dealer', async () => {
    vi.mocked(repo.listEntries).mockResolvedValue({ items: [], nextCursor: null } as never);

    await list(adminCtx, { limit: 50 });

    expect(repo.listEntries).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: undefined }));
  });
});
