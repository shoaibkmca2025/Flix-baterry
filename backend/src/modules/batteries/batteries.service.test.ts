import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({
  db: {},
  withTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('../../utils/audit', () => ({ audit: vi.fn() }));

vi.mock('./batteries.repository', () => ({
  findBatteryByCode: vi.fn(),
  findBatteryById: vi.fn(),
  findModelById: vi.fn(),
  findChainById: vi.fn(),
  listBatteries: vi.fn(),
  insertBattery: vi.fn(),
  updateBatteryAfterReplacement: vi.fn(),
  updateBatteryChainId: vi.fn(),
  insertChain: vi.fn(),
  incrementChainReplacementCount: vi.fn(),
  insertReplacementLink: vi.fn(),
}));

import * as repo from './batteries.repository';
import { list, lookup, recordReplacement, recordSale } from './batteries.service';
import type { Ctx } from '../../utils/context';

const now = () => new Date('2026-09-17T10:00:00Z');
const dealerCtx: Ctx = {
  user: { id: 'user-1', scope: 'dealer', role: 'dealer_manager', dealerId: 'dealer-1' },
  request: { id: 'req-1', ip: '127.0.0.1', deviceId: 'device-1', userAgent: 'vitest' },
  now,
};
const otherDealerCtx: Ctx = { ...dealerCtx, user: { ...dealerCtx.user!, dealerId: 'dealer-2' } };
const adminCtx: Ctx = { ...dealerCtx, user: { id: 'admin-1', scope: 'admin', role: 'main_admin' } };
const anonCtx: Ctx = { ...dealerCtx, user: null };

beforeEach(() => vi.clearAllMocks());

describe('lookup', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(lookup(anonCtx, '26041212')).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a malformed code before touching the database', async () => {
    await expect(lookup(dealerCtx, '123')).rejects.toMatchObject({ code: 'format_mismatch' });
    expect(repo.findBatteryByCode).not.toHaveBeenCalled();
  });

  it('returns a warranty preview for a code with no existing battery', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue(undefined);

    const result = await lookup(dealerCtx, '26041212');

    expect(result).toMatchObject({ found: false, mfgMonth: '2026-04', serialNo: '1212', model: null, custody: null });
    expect(result.cover.inWarranty).toBe(true);
  });

  it("marks a battery held by the caller's own dealer as 'yours'", async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({
      id: 'batt-1', batteryCode: '26041212', serialNo: '1212', modelId: 'M5', mfgMonth: '2026-04',
      state: 'sold', custodian: 'dealer', dealerId: 'dealer-1',
    } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24 } as never);

    const result = await lookup(dealerCtx, '26041212');

    expect(result).toMatchObject({ found: true, custody: 'yours' });
    if (result.found) expect(result.battery.dealerId).toBe('dealer-1');
  });

  it("marks a battery held by a DIFFERENT dealer as 'other' and hides which one", async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({
      id: 'batt-1', batteryCode: '26041212', serialNo: '1212', modelId: 'M5', mfgMonth: '2026-04',
      state: 'sold', custodian: 'dealer', dealerId: 'dealer-1',
    } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24 } as never);

    const result = await lookup(otherDealerCtx, '26041212');

    expect(result).toMatchObject({ found: true, custody: 'other' });
    if (result.found) expect(result.battery.dealerId).toBeNull();
  });

  it('lets an admin see the real dealerId even when custody is "other"', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({
      id: 'batt-1', batteryCode: '26041212', serialNo: '1212', modelId: 'M5', mfgMonth: '2026-04',
      state: 'sold', custodian: 'dealer', dealerId: 'dealer-1',
    } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24 } as never);

    const result = await lookup(adminCtx, '26041212');

    expect(result).toMatchObject({ found: true, custody: 'other' });
    if (result.found) expect(result.battery.dealerId).toBe('dealer-1');
  });

  it('reports an expired battery correctly', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({
      id: 'batt-2', batteryCode: '21030047', serialNo: '0047', modelId: 'M5', mfgMonth: '2021-03',
      state: 'sold', custodian: 'customer', dealerId: null,
    } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24 } as never);

    const result = await lookup(dealerCtx, '21030047');

    expect(result).toMatchObject({ found: true, custody: 'customer' });
    expect(result.cover.inWarranty).toBe(false);
  });
});

describe('list', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(list(anonCtx, { limit: 50 })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it("scopes a dealer caller to their own dealerId, ignoring what's asked", async () => {
    vi.mocked(repo.listBatteries).mockResolvedValue({ items: [], nextCursor: null } as never);

    await list(dealerCtx, { limit: 50 });

    expect(repo.listBatteries).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: 'dealer-1' }));
  });

  it('does not scope an admin caller to any dealer', async () => {
    vi.mocked(repo.listBatteries).mockResolvedValue({ items: [], nextCursor: null } as never);

    await list(adminCtx, { limit: 50 });

    expect(repo.listBatteries).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: undefined }));
  });
});

describe('recordSale', () => {
  it('rejects a code that is already registered', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({ id: 'existing' } as never);
    await expect(recordSale(dealerCtx, { code: '26041212', modelId: 'M5' })).rejects.toMatchObject({ code: 'duplicate_serial' });
  });

  it('creates the battery and a chain anchored to the sale date, not the manufacture date', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue(undefined);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', warrantyMonths: 24 } as never);
    vi.mocked(repo.insertBattery).mockResolvedValue({ id: 'batt-1', batteryCode: '26041212' } as never);
    vi.mocked(repo.insertChain).mockResolvedValue({ id: 'chain-1', warrantyStart: '2026-01-15', warrantyExpiry: '2028-01-14' } as never);
    vi.mocked(repo.updateBatteryChainId).mockResolvedValue({ id: 'batt-1', chainId: 'chain-1' } as never);

    const result = await recordSale(dealerCtx, { code: '26041212', modelId: 'M5', saleDate: '2026-01-15' });

    // the code's own mfg month is 2026-04, but the chain anchors to the SALE date (Jan), not that.
    expect(repo.insertChain).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ warrantyStart: '2026-01-15', warrantyExpiry: '2028-01-14' }));
    expect(result.chain.warrantyStart).toBe('2026-01-15');
  });
});

describe('recordReplacement — warranty never restarts across multiple replacements', () => {
  const chain = { id: 'chain-1', rootBatteryId: 'batt-jan', warrantyStart: '2026-01-15', warrantyExpiry: '2028-01-14', termMonths: 24, replacementCount: 0 };

  it('rejects an old battery with no chain (never sold through the system)', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({ id: 'batt-1', batteryCode: '26010001', chainId: null } as never);
    await expect(recordReplacement(dealerCtx, { oldCode: '26010001', newCode: '26031111', newModelId: 'M5' })).rejects.toMatchObject({ code: 'old_not_on_record' });
  });

  it('rejects a battery already replaced once', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({ id: 'batt-jan', batteryCode: '26010001', chainId: 'chain-1', replacedById: 'batt-mar', custodian: 'dealer', dealerId: 'dealer-1' } as never);
    await expect(recordReplacement(dealerCtx, { oldCode: '26010001', newCode: '26031111', newModelId: 'M5' })).rejects.toMatchObject({ code: 'already_replaced' });
  });

  it('rejects when a different dealer holds the old battery', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({ id: 'batt-jan', batteryCode: '26010001', chainId: 'chain-1', replacedById: null, custodian: 'dealer', dealerId: 'dealer-2' } as never);
    await expect(recordReplacement(dealerCtx, { oldCode: '26010001', newCode: '26031111', newModelId: 'M5' })).rejects.toMatchObject({ code: 'custody_conflict' });
  });

  it('blocks a replacement once the chain has expired', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({ id: 'batt-jan', batteryCode: '26010001', chainId: 'chain-1', replacedById: null, custodian: 'dealer', dealerId: 'dealer-1' } as never);
    vi.mocked(repo.findChainById).mockResolvedValue(chain as never);

    await expect(
      recordReplacement(dealerCtx, { oldCode: '26010001', newCode: '26031111', newModelId: 'M5', replacementDate: '2029-01-01' }),
    ).rejects.toMatchObject({ code: 'warranty_expired' });
  });

  it("the FIRST replacement (Jan -> March) inherits the January chain's dates unchanged", async () => {
    vi.mocked(repo.findBatteryByCode).mockImplementation(async (_dbh, code) => {
      if (code === '26010001') return { id: 'batt-jan', batteryCode: '26010001', chainId: 'chain-1', replacedById: null, custodian: 'dealer', dealerId: 'dealer-1' } as never;
      return undefined; // new code not registered yet
    });
    vi.mocked(repo.findChainById).mockResolvedValue(chain as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', warrantyMonths: 24 } as never);
    vi.mocked(repo.insertBattery).mockResolvedValue({ id: 'batt-mar', batteryCode: '26031111', chainId: 'chain-1' } as never);
    vi.mocked(repo.incrementChainReplacementCount).mockResolvedValue({ ...chain, replacementCount: 1 } as never);

    const result = await recordReplacement(dealerCtx, { oldCode: '26010001', newCode: '26031111', newModelId: 'M5', replacementDate: '2026-03-10' });

    // the new battery's OWN manufacture month (March) never enters the chain — it inherits
    // chain-1's original January dates, exactly the rule the team described.
    expect(repo.insertBattery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ chainId: 'chain-1', replacedFromId: 'batt-jan' }));
    expect(result.chain.warrantyStart).toBe('2026-01-15');
    expect(result.chain.warrantyExpiry).toBe('2028-01-14');
    expect(result.chain.replacementCount).toBe(1);
  });

  it('a SECOND replacement (of the March battery) still resolves back to the original January chain', async () => {
    // this is the exact scenario described: "if you come again for replacement... we check
    // the OLD BATTERY warranty" — the battery handed in (March's) is itself already a
    // replacement, but its chainId still points at the January chain.
    vi.mocked(repo.findBatteryByCode).mockImplementation(async (_dbh, code) => {
      if (code === '26031111') return { id: 'batt-mar', batteryCode: '26031111', chainId: 'chain-1', replacedById: null, custodian: 'dealer', dealerId: 'dealer-1' } as never;
      return undefined;
    });
    vi.mocked(repo.findChainById).mockResolvedValue({ ...chain, replacementCount: 1 } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', warrantyMonths: 24 } as never);
    vi.mocked(repo.insertBattery).mockResolvedValue({ id: 'batt-jun', batteryCode: '26069999', chainId: 'chain-1' } as never);
    vi.mocked(repo.incrementChainReplacementCount).mockResolvedValue({ ...chain, replacementCount: 2 } as never);

    const result = await recordReplacement(dealerCtx, { oldCode: '26031111', newCode: '26069999', newModelId: 'M5', replacementDate: '2026-06-01' });

    expect(repo.insertBattery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ chainId: 'chain-1', replacedFromId: 'batt-mar' }));
    expect(result.chain.warrantyStart).toBe('2026-01-15'); // still January — never restarted
    expect(result.chain.warrantyExpiry).toBe('2028-01-14');
  });
});
