import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({ db: {} }));
vi.mock('../../utils/settings', () => ({ graceMonths: vi.fn(async () => 2) }));

vi.mock('./batteries.repository', () => ({
  findBatteryByCode: vi.fn(),
  findModelById: vi.fn(),
  findChainById: vi.fn(),
  findReplacementLinkByNewBatteryId: vi.fn(),
  listBatteries: vi.fn(),
}));

import * as repo from './batteries.repository';
import { list, lookup } from './batteries.service';
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

    expect(result).toMatchObject({ found: false, mfgMonth: '2026-04', serialNo: '1212', model: null, custody: null, labelModelId: null });
    expect(result.cover).toMatchObject({ startDate: '2026-04-01', expiryDate: '2028-05-31', termMonths: 24, graceMonths: 2, inWarranty: true }); // default term + grace
  });

  it('a not-on-record battery is priced by the plate + model the dealer chose, or by the label prefix', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue(undefined);
    vi.mocked(repo.findModelById).mockImplementation(async (_db, id: string) => ({ id, plate: id[0], modelNo: id.slice(1), family: id[0], type: 'IT', capacity: null, warrantyMonths: id === 'M2200' ? 30 : 24 }) as never);

    const chosen = await lookup(dealerCtx, '26041212', 'M2200');
    expect(chosen.cover).toMatchObject({ expiryDate: '2028-11-30', termMonths: 30 }); // 30 + 2 from April 2026
    expect(chosen.model).toMatchObject({ id: 'M2200', plate: 'M', modelNo: '2200' });

    const fromLabel = await lookup(dealerCtx, 'N2200-26041212');
    expect(fromLabel).toMatchObject({ labelModelId: 'N2200', serialNo: '1212' });
    expect(fromLabel.cover).toMatchObject({ expiryDate: '2028-05-31', termMonths: 24 });
    expect(repo.findBatteryByCode).toHaveBeenLastCalledWith(expect.anything(), '26041212'); // the prefix never reaches the code lookup
  });

  it("marks a battery held by the caller's own dealer as 'yours'", async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({
      id: 'batt-1', batteryCode: '26041212', serialNo: '1212', modelId: 'M5', mfgMonth: '2026-04',
      state: 'sold', custodian: 'dealer', dealerId: 'dealer-1', chainId: null,
    } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24 } as never);

    const result = await lookup(dealerCtx, '26041212');

    expect(result).toMatchObject({ found: true, custody: 'yours' });
    if (result.found) expect(result.battery.dealerId).toBe('dealer-1');
  });

  it("marks a battery held by a DIFFERENT dealer as 'other' and hides which one", async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({
      id: 'batt-1', batteryCode: '26041212', serialNo: '1212', modelId: 'M5', mfgMonth: '2026-04',
      state: 'sold', custodian: 'dealer', dealerId: 'dealer-1', chainId: null,
    } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24 } as never);

    const result = await lookup(otherDealerCtx, '26041212');

    expect(result).toMatchObject({ found: true, custody: 'other' });
    if (result.found) expect(result.battery.dealerId).toBeNull();
  });

  it('lets an admin see the real dealerId even when custody is "other"', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({
      id: 'batt-1', batteryCode: '26041212', serialNo: '1212', modelId: 'M5', mfgMonth: '2026-04',
      state: 'sold', custodian: 'dealer', dealerId: 'dealer-1', chainId: null,
    } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24 } as never);

    const result = await lookup(adminCtx, '26041212');

    expect(result).toMatchObject({ found: true, custody: 'other' });
    if (result.found) expect(result.battery.dealerId).toBe('dealer-1');
  });

  it('reports an expired battery correctly (no chain — falls back to mfg-month rule)', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({
      id: 'batt-2', batteryCode: '21030047', serialNo: '0047', modelId: 'M5', mfgMonth: '2021-03',
      state: 'sold', custodian: 'customer', dealerId: null, chainId: null,
    } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24 } as never);

    const result = await lookup(dealerCtx, '21030047');

    expect(result).toMatchObject({ found: true, custody: 'customer' });
    expect(result.cover.inWarranty).toBe(false);
  });

  it('prefers the chain date over the mfg-month rule once a battery is part of a chain', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({
      id: 'batt-3', batteryCode: '26060303', serialNo: '0303', modelId: 'M5', mfgMonth: '2026-06',
      state: 'replacement', custodian: 'customer', dealerId: 'dealer-1', chainId: 'chain-1',
    } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24 } as never);
    vi.mocked(repo.findChainById).mockResolvedValue({ id: 'chain-1', warrantyStart: '2026-01-15', warrantyExpiry: '2028-01-14', termMonths: 26 } as never);

    const result = await lookup(dealerCtx, '26060303');

    expect(result.cover.expiryDate).toBe('2028-01-14');
    expect((result.cover as { warrantyStart: string }).warrantyStart).toBe('2026-01-15'); // January, not the battery's own June mfg month
    expect(result.cover.mfgMonth).toBe('2026-06'); // the chain decides cover, but the mfg month is still reported
  });

  it('tells the old-battery screen everything about a replacement battery: purchase date, install date, chain depth, state', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({
      id: 'batt-3', batteryCode: '26060303', serialNo: '0303', modelId: 'M5', mfgMonth: '2026-06', notOnRecord: false,
      state: 'replacement', custodian: 'dealer', dealerId: 'dealer-1', chainId: 'chain-1', replacedFromId: 'batt-1', replacedById: null,
    } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', family: 'M', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24 } as never);
    vi.mocked(repo.findChainById).mockResolvedValue({ id: 'chain-1', rootBatteryId: 'batt-1', warrantyStart: '2026-01-15', warrantyExpiry: '2028-01-14', termMonths: 24, replacementCount: 1 } as never);
    vi.mocked(repo.findReplacementLinkByNewBatteryId).mockResolvedValue({ newBatteryId: 'batt-3', replacedAt: '2026-03-10' } as never);

    const result = await lookup(dealerCtx, '26060303');

    expect(result).toMatchObject({
      found: true,
      mfgMonth: '2026-06',
      serialNo: '0303',
      battery: { state: 'replacement', alreadyReplaced: false, isReplacement: true, mfgMonth: '2026-06' },
      model: { id: 'M5', family: 'M', capacity: '150Ah' },
      chain: { purchaseDate: '2026-01-15', warrantyExpiry: '2028-01-14', replacementCount: 1, isOriginal: false, installedOn: '2026-03-10' },
      custody: 'yours',
    });
    expect(repo.findReplacementLinkByNewBatteryId).toHaveBeenCalledWith(expect.anything(), 'batt-3');
  });

  it('flags a battery that has already been replaced, and does not look for a link on an original sale', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({
      id: 'batt-1', batteryCode: '26041212', serialNo: '1212', modelId: 'M5', mfgMonth: '2026-04', notOnRecord: false,
      state: 'returned', custodian: 'dealer', dealerId: 'dealer-1', chainId: 'chain-1', replacedFromId: null, replacedById: 'batt-3',
    } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M5', family: 'M', type: 'IT tall tubular', capacity: '150Ah', warrantyMonths: 24 } as never);
    vi.mocked(repo.findChainById).mockResolvedValue({ id: 'chain-1', rootBatteryId: 'batt-1', warrantyStart: '2026-01-15', warrantyExpiry: '2028-01-14', termMonths: 24, replacementCount: 1 } as never);

    const result = await lookup(dealerCtx, '26041212');

    expect(result).toMatchObject({ battery: { alreadyReplaced: true, isReplacement: false }, chain: { isOriginal: true, installedOn: null } });
    expect(repo.findReplacementLinkByNewBatteryId).not.toHaveBeenCalled();
  });

  it('falls back to the code-derived mfg month when the row has none (legacy import), and reports no chain', async () => {
    vi.mocked(repo.findBatteryByCode).mockResolvedValue({
      id: 'batt-9', batteryCode: '24020099', serialNo: '0099', modelId: 'M3', mfgMonth: null, notOnRecord: true,
      state: 'sold', custodian: 'customer', dealerId: null, chainId: null, replacedFromId: null, replacedById: null,
    } as never);
    vi.mocked(repo.findModelById).mockResolvedValue({ id: 'M3', family: 'M', type: 'IT tall tubular', capacity: '135Ah', warrantyMonths: 24 } as never);

    const result = await lookup(dealerCtx, '24020099');

    expect(result).toMatchObject({ mfgMonth: '2024-02', chain: null, battery: { notOnRecord: true, mfgMonth: '2024-02' } });
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
