import { beforeEach, describe, expect, it, vi } from 'vitest';

// `db` is the pool, `tx` the transaction — different objects, so a query that runs on the pool
// inside a transaction (no read-your-writes, a second connection held) is visible to the tests.
vi.mock('../../database/client', () => ({
  db: { handle: 'pool' },
  withTransaction: (fn: (tx: unknown) => unknown) => fn({ handle: 'tx' }),
}));

vi.mock('../../utils/audit', () => ({ audit: vi.fn() }));

vi.mock('../../utils/ids', () => ({
  nextFormattedRef: vi.fn(async (_tx: unknown, prefix: string) => `${prefix}-26-09-0001`),
  monthKey: vi.fn(() => '26-09'),
}));

vi.mock('../batteries/batteries.repository', () => ({
  findBatteryByCode: vi.fn(),
  listModels: vi.fn(async () => [{ id: 'M1000' }, { id: 'GPM1000' }, { id: 'S1000' }, { id: 'M2200' }, { id: 'N2200' }, { id: 'SG2200' }, { id: 'M5' }, { id: 'OLD1' }]),
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
  findClaimById: vi.fn(),
}));
vi.mock('../claims/claims.service', () => ({ dispatch: vi.fn(), receive: vi.fn(), check: vi.fn(), decide: vi.fn() }));
// default: every old battery has arrived at the factory on a challan (tests override per case)
vi.mock('../returns/returns.repository', () => ({ findLinesByEntryItemIds: vi.fn() }));

vi.mock('../../utils/settings', () => ({ graceMonths: vi.fn(async () => 2), serialDigitLengths: vi.fn(async () => [7, 8]) }));

// dealer-1 is a distributor; dealer-1a is a dealer under him (client, 2 Oct 2026)
vi.mock('../dealers/dealers.repository', () => ({
  findDealerById: vi.fn(async (_db: unknown, id: string) => (id === 'dealer-1' ? { id, status: 'active', kind: 'distributor', distributorId: null, name: 'Felix Factory' }
    : id === 'dealer-1a' ? { id, status: 'active', kind: 'dealer', distributorId: 'dealer-1', name: 'Patil Batteries' }
    : id === 'dealer-2a' ? { id, status: 'active', kind: 'dealer', distributorId: 'dealer-2', name: 'Other dealer' }
    : id === 'dealer-suspended' ? { id, status: 'suspended' } : undefined)),
}));
vi.mock('../dealers/dealers.service', () => ({
  visibleShopIds: vi.fn(async (ctx: { user: { dealerId: string } }) => new Set(ctx.user.dealerId === 'dealer-1' ? ['dealer-1', 'dealer-1a'] : [ctx.user.dealerId])),
  requireDistributor: vi.fn(async (ctx: { user: { dealerId: string } }) => {
    if (ctx.user.dealerId !== 'dealer-1') throw Object.assign(new Error('Only a distributor can do this.'), { code: 'distributor_only', status: 403 });
    return { id: 'dealer-1', name: 'Felix Factory', kind: 'distributor' };
  }),
}));

vi.mock('../stock/stock.service', () => ({
  postMovementInTx: vi.fn(async (_tx: unknown, _ctx: unknown, input: { battery: { id: string } | null; batteryId?: string; toState: string; toCustodian: string }) => ({
    movement: { id: 'mv-1' },
    battery: input.battery ? { ...input.battery, state: input.toState, custodian: input.toCustodian } : null,
  })),
}));

vi.mock('./entries.repository', () => ({
  findEntryById: vi.fn(),
  findItemById: vi.fn(),
  updateEntryItem: vi.fn(),
  findItemsByEntryId: vi.fn(),
  findItemsByEntryIds: vi.fn().mockResolvedValue([]),
  insertEntry: vi.fn(),
  insertEntryItem: vi.fn(),
  updateEntryItemLinks: vi.fn(),
  updateEntryStatus: vi.fn(),
  listEntries: vi.fn(),
  upsertPhoto: vi.fn(),
  setDistributorDecision: vi.fn(),
  setSpecialDecision: vi.fn(),
  findPhotosByEntryId: vi.fn(),
}));
vi.mock('../../utils/storage', () => ({ putObject: vi.fn(), signedUrl: vi.fn(async (key: string) => `https://storage.example/${key}?sig=1`) }));

import * as batteriesRepo from '../batteries/batteries.repository';
import * as claimsRepo from '../claims/claims.repository';
import * as claimsService from '../claims/claims.service';
import * as returnsRepo from '../returns/returns.repository';
import { postMovementInTx } from '../stock/stock.service';
import * as repo from './entries.repository';
import { nextFormattedRef } from '../../utils/ids';
import { addPhoto, approve, correctItem, create, decideSpecial, distributorDecide, getById, list, listPhotos, markArrived, reject, reviewItem, settle } from './entries.service';
import { putObject } from '../../utils/storage';
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

/**
 * A request as a SHOP sends one.
 *
 * It used to default to `regular_sales`, which no shop may send — that is head office's to
 * record, and nothing enforced it until QA walked a dealer's plain sale through approval
 * (6 Oct 2026). A replacement is what these tests are really about: it is a dealer-sendable type
 * and its new battery follows the 7/8/9 rule the format cases below check.
 */
/** One replacement item, with whatever the case under test wants changed about it. */
const repItem = (over: Record<string, unknown> = {}) =>
  ({ modelId: 'M5', code: '26041212', oldCode: '26030777', oldModelId: 'M5', faultCode: 'low_backup', ...over });

function baseBody(overrides: Partial<EntryCreateBody> = {}): EntryCreateBody {
  return {
    entryType: 'replacement',
    place: 'Nashik',
    items: [{ modelId: 'M5', code: '26041212', oldCode: '26030777', oldModelId: 'M5', faultCode: 'low_backup' }],
    coverTold: false,
    ...overrides,
  } as EntryCreateBody;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(returnsRepo.findLinesByEntryItemIds).mockImplementation((async (_db: unknown, ids: string[]) => ids.map((id) => ({ entryItemId: id, stage: 'received' }))) as never);
  // every (plate, model) named in an entry must exist — M5/M2200 are the known ones in these tests
  vi.mocked(batteriesRepo.findModelById).mockImplementation(async (_db, id: string) => (['M5', 'M2200', 'N2200'].includes(id) ? { id, warrantyMonths: id === 'M2200' ? 30 : 24, active: true } : id === 'OLD1' ? { id, warrantyMonths: 24, active: false } : undefined) as never);
});

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
    await expect(create(dealerCtx, baseBody({ items: [repItem({ code: '123' })] } as never))).rejects.toMatchObject({ code: 'format_mismatch' });
    expect(repo.insertEntry).not.toHaveBeenCalled();
  });

  it('a NEW battery may have 7, 8 or 9 digits — all three plants are in use (client rule, 2 Oct 2026)', async () => {
    vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-len', ref: 'ENT-26-10-0001' } as never);
    vi.mocked(repo.insertEntryItem).mockResolvedValue({ id: 'item-len' } as never);
    // 2609 + 3, 4 and 5 serial digits: every form the plants print is accepted on a new battery
    for (const code of ['2609123', '26091234', '260912345']) {
      await expect(create(dealerCtx, baseBody({ items: [repItem({ code })] } as never))).resolves.toBeTruthy();
    }
  });

  it('a length no plant prints is still refused, and the message names the three that are', async () => {
    // too short, too long, and a month that does not exist — none reach a transaction. The
    // long one also proves 10 digits is not quietly trimmed to the valid 8-digit tail '09123456'.
    for (const code of ['260912', '2609123456', '269912345']) {
      await expect(create(dealerCtx, baseBody({ items: [repItem({ code })] } as never)))
        .rejects.toMatchObject({ code: 'format_mismatch', field: 'items.0.code', message: expect.stringContaining('a 7-, 8- or 9-digit number') });
    }
    expect(repo.insertEntry).not.toHaveBeenCalled();
  });

  it('a 9-digit battery we issued can come back as the OLD battery on a replacement', async () => {
    // the whole point of anyDigitLengths: a form we hand out must be readable when it returns
    vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-9', ref: 'ENT-26-10-0002' } as never);
    vi.mocked(repo.insertEntryItem).mockResolvedValue({ id: 'item-9' } as never);
    await expect(create(dealerCtx, baseBody({ entryType: 'replacement', items: [{ modelId: 'M5', code: '26101234', oldCode: '260912345', faultCode: 'not_holding_charge' }] })))
      .resolves.toBeTruthy();
  });

  it('a 7-digit OLD battery with an 8-digit new one passes the format check', async () => {
    vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-7', ref: 'ENT-26-09-0007' } as never);
    vi.mocked(repo.insertEntryItem).mockResolvedValue({ id: 'item-7' } as never);
    const r = create(dealerCtx, baseBody({ entryType: 'replacement', items: [{ modelId: 'M5', code: '26091234', oldCode: '2605231', faultCode: 'not_holding_charge' }] }));
    await expect(r).resolves.toBeTruthy();
  });

  // RP and SR, each with its own series, so a reference says what it is at a glance (client,
  // 3 Oct 2026). Requests numbered before this keep their ENT- reference.
  it('tags a replacement RP and a sales return SR, on separate counters', async () => {
    vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-9', ref: 'RP-26-09-0001' } as never);
    vi.mocked(repo.insertEntryItem).mockResolvedValue({ id: 'item-9' } as never);

    await create(dealerCtx, baseBody({ entryType: 'replacement', items: [{ modelId: 'M5', code: '26090001', oldCode: '26041212', oldModelId: 'M5', faultCode: 'low_backup' }] }));
    expect(nextFormattedRef).toHaveBeenLastCalledWith(expect.anything(), 'RP', 'entry_rp', expect.any(String));

    await create(dealerCtx, baseBody({ entryType: 'sales_return', returnKind: 'unsold', items: [{ modelId: 'M5', code: '2605231' }] }));
    expect(nextFormattedRef).toHaveBeenLastCalledWith(expect.anything(), 'SR', 'entry_sr', expect.any(String));
  });

  it('a sales return says which kind it is, and the kind is stored', async () => {
    vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-10', ref: 'SR-26-09-0002' } as never);
    vi.mocked(repo.insertEntryItem).mockResolvedValue({ id: 'item-10' } as never);

    await create(dealerCtx, baseBody({ entryType: 'sales_return', returnKind: 'defective', items: [{ modelId: 'M5', code: '2605231' }] }));
    expect(repo.insertEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ returnKind: 'defective' }));

    // a replacement never carries one
    await create(dealerCtx, baseBody({ entryType: 'replacement', items: [{ modelId: 'M5', code: '26090001', oldCode: '26041212', oldModelId: 'M5', faultCode: 'low_backup' }] }));
    expect(repo.insertEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ returnKind: null }));
  });

  // Head office records what it finds, not what the rules expect (client, 3 Oct 2026).
  describe('head office records without the judgement checks', () => {
    const anything = (over: object = {}) => baseBody({
      dealerId: 'dealer-1', entryType: 'replacement',
      items: [{ modelId: 'M5', code: '999', oldCode: '1', faultCode: undefined, ...over }],
    } as never);

    beforeEach(() => {
      vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-a', ref: 'RP-26-10-0009' } as never);
      vi.mocked(repo.insertEntryItem).mockResolvedValue({ id: 'item-a' } as never);
    });

    it('takes a serial in no recognised form, and a replacement with no fault', async () => {
      await expect(create(adminCtx, anything())).resolves.toBeTruthy();
      expect(repo.insertEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ byAdmin: true }));
    });

    it('takes a sales return that does not say which kind it is', async () => {
      await expect(create(adminCtx, baseBody({ dealerId: 'dealer-1', entryType: 'sales_return', items: [{ modelId: 'M5', code: 'xx' }] } as never))).resolves.toBeTruthy();
    });

    it('takes a model that is no longer sold', async () => {
      vi.mocked(batteriesRepo.findModelById).mockResolvedValue({ id: 'M5', active: false, warrantyMonths: 24 } as never);
      await expect(create(adminCtx, anything())).resolves.toBeTruthy();
    });

    it('still refuses a product that does not exist, and a blank serial', async () => {
      vi.mocked(batteriesRepo.findModelById).mockResolvedValue(undefined as never);
      await expect(create(adminCtx, anything())).rejects.toMatchObject({ code: 'model_unknown' });
      vi.mocked(batteriesRepo.findModelById).mockResolvedValue({ id: 'M5', active: true, warrantyMonths: 24 } as never);
      await expect(create(adminCtx, anything({ code: '   ' }))).rejects.toMatchObject({ code: 'code_required' });
    });

    it("a shop's own request is still held to every rule", async () => {
      await expect(create(dealerCtx, baseBody({ entryType: 'replacement', items: [{ modelId: 'M5', code: '999', oldCode: '1', faultCode: 'low_backup' }] })))
        .rejects.toMatchObject({ code: 'format_mismatch' });
      await expect(create(dealerCtx, baseBody({ entryType: 'replacement', items: [{ modelId: 'M5', code: '26090001', oldCode: '26041212', faultCode: undefined }] } as never)))
        .rejects.toMatchObject({ code: 'validation_error' });
      await expect(create(dealerCtx, baseBody({ entryType: 'sales_return', items: [{ modelId: 'M5', code: '2605231' }] })))
        .rejects.toMatchObject({ code: 'validation_error' });
    });
  });

  it("a shop's request cannot be dated in the future, nor long in the past", async () => {
    vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-d', ref: 'RP-26-10-0002' } as never);
    vi.mocked(repo.insertEntryItem).mockResolvedValue({ id: 'item-d' } as never);
    await expect(create(dealerCtx, baseBody({ entryDate: '2099-01-01' }))).rejects.toMatchObject({ field: 'entryDate' });
    await expect(create(dealerCtx, baseBody({ entryDate: '2020-01-01' }))).rejects.toMatchObject({ field: 'entryDate' });
    // head office is not held to the window — it records what it finds
    await expect(create(adminCtx, baseBody({ dealerId: 'dealer-1', entryDate: '2020-01-01' }))).resolves.toBeTruthy();
  });

  it('a plain sale is head office’s to record, never a shop’s', async () => {
    await expect(create(dealerCtx, baseBody({ entryType: 'regular_sales' })))
      .rejects.toMatchObject({ code: 'entry_type_not_allowed', status: 403 });
    vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-s', ref: 'ENT-26-10-0003' } as never);
    vi.mocked(repo.insertEntryItem).mockResolvedValue({ id: 'item-s' } as never);
    await expect(create(adminCtx, baseBody({ dealerId: 'dealer-1', entryType: 'regular_sales' }))).resolves.toBeTruthy();
  });

  it('a sales return (a battery already in the field) may have 7 digits', async () => {
    vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-8', ref: 'ENT-26-09-0008' } as never);
    vi.mocked(repo.insertEntryItem).mockResolvedValue({ id: 'item-8' } as never);
    await expect(create(dealerCtx, baseBody({ entryType: 'sales_return', returnKind: 'unsold', items: [{ modelId: 'M5', code: '2605231' }] }))).resolves.toBeTruthy();
  });

  it('rejects a replacement item whose old and new codes are the same', async () => {
    const body = baseBody({ entryType: 'replacement', items: [{ modelId: 'M5', code: '26041212', oldCode: '26041212', faultCode: 'not_holding_charge' }] });
    await expect(create(dealerCtx, body)).rejects.toMatchObject({ code: 'old_equals_new' });
  });

  it('rejects the same battery code appearing twice in one entry', async () => {
    const body = baseBody({ items: [repItem(), repItem({ oldCode: '26030778' })] } as never);
    await expect(create(dealerCtx, body)).rejects.toMatchObject({ code: 'duplicate_serial' });
  });

  it('inserts the entry and its items in one transaction, scoped to the caller dealer', async () => {
    vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-1', ref: 'ENT-26-09-0001' } as never);
    vi.mocked(repo.insertEntryItem).mockResolvedValue({ id: 'item-1' } as never);

    const result = await create(dealerCtx, baseBody());

    expect(result).toMatchObject({ id: 'entry-1', ref: 'ENT-26-09-0001' });
    expect(repo.insertEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: 'dealer-1', entryType: 'replacement', totalQty: 1 }));
    expect(repo.insertEntryItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entryId: 'entry-1', batteryCode: 'M526041212' })); // product + digits (D-13)
  });

  it('refuses an unknown or discontinued plate + model combination (that row is where the warranty term lives)', async () => {
    await expect(create(dealerCtx, baseBody({ items: [repItem({ modelId: 'Z9', oldModelId: 'Z9' })] } as never))).rejects.toMatchObject({ code: 'model_unknown', field: 'items.0.modelId' });
    await expect(create(dealerCtx, baseBody({ items: [repItem({ modelId: 'OLD1', oldModelId: 'OLD1' })] } as never))).rejects.toMatchObject({ code: 'model_inactive' });
    expect(repo.insertEntry).not.toHaveBeenCalled();
  });

  it("stores the OLD battery's plate + model: the dealer's choice, else the label prefix, else like-for-like", async () => {
    vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-1', ref: 'ENT-26-09-0001' } as never);
    const rep = (over: object) => baseBody({ entryType: 'replacement', items: [{ modelId: 'M2200', code: '26098001', oldCode: '26041212', faultCode: 'x', ...over }] });

    await create(dealerCtx, rep({ oldModelId: 'N2200' }));
    expect(repo.insertEntryItem).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ oldModelId: 'N2200' }));

    await create(dealerCtx, rep({ oldCode: 'N2200-26041212' }));
    expect(repo.insertEntryItem).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ oldBatteryCode: 'N220026041212', oldModelId: 'N2200' }));

    await create(dealerCtx, rep({}));
    expect(repo.insertEntryItem).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ oldModelId: 'M2200' }));
  });
});

describe('approve — regular_sales (first sale, opens a new chain)', () => {
  it('creates a battery and a fresh warranty chain anchored to the MANUFACTURE month: term + 2 grace months (D-11)', async () => {
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

    // code 26041212 → made April 2026; M5 is 24 months + 2 grace → 2026-04-01 … 2028-05-31, whatever the sale date
    expect(batteriesRepo.insertChain).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ rootBatteryId: 'batt-1', warrantyStart: '2026-04-01', warrantyExpiry: '2028-05-31', termMonths: 24, graceMonths: 2 }));
    expect(result.entry.status).toBe('approved');
  });

  it('reads through the TRANSACTION, not the pool — an approval must see its own writes', async () => {
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

    await approve(adminCtx, 'entry-1', 'Looks good');

    const handles = [...vi.mocked(batteriesRepo.findBatteryByCode).mock.calls, ...vi.mocked(batteriesRepo.findModelById).mock.calls]
      .map((call) => (call[0] as { handle?: string })?.handle);
    expect(handles.length).toBeGreaterThan(0);
    expect(handles).not.toContain('pool');
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

  it('an old battery NOT on record is put on record from its manufacture month and the plate + model named, then judged like any other', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    // old code 21030047 → made March 2021; an M2200 (30 + 2 months) would have ended 2023-10-31 → expired
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([{ ...item, oldBatteryCode: 'M220021030047', oldBatteryCodeEntered: '21030047', oldModelId: 'M2200' }] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue(undefined);
    vi.mocked(batteriesRepo.insertBattery).mockResolvedValue({ id: 'old-new', custodian: 'customer', dealerId: 'dealer-1', replacedById: null } as never);
    vi.mocked(batteriesRepo.insertChain).mockResolvedValue({ id: 'chain-old', warrantyStart: '2021-03-01', warrantyExpiry: '2023-10-31' } as never);
    vi.mocked(batteriesRepo.updateBatteryChainId).mockResolvedValue({ id: 'old-new', chainId: 'chain-old', custodian: 'customer', dealerId: 'dealer-1', replacedById: null } as never);
    vi.mocked(batteriesRepo.findChainById).mockResolvedValue({ id: 'chain-old', warrantyStart: '2021-03-01', warrantyExpiry: '2023-10-31', replacementCount: 0 } as never);

    await expect(approve(adminCtx, 'entry-1', 'ok')).rejects.toMatchObject({ code: 'warranty_expired' });
    expect(batteriesRepo.insertBattery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ batteryCode: 'M220021030047', modelId: 'M2200', notOnRecord: true, state: 'sold', custodian: 'customer', dealerId: 'dealer-1' }));
    expect(batteriesRepo.insertChain).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ rootBatteryId: 'old-new', warrantyStart: '2021-03-01', warrantyExpiry: '2023-10-31', termMonths: 30, graceMonths: 2 }));
  });

  it('a not-on-record old battery still in cover goes through: chain created, replacement linked, claim raised', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([{ ...item, oldBatteryCode: 'M220026010047', oldBatteryCodeEntered: 'M2200-26010047', oldModelId: 'M2200' }] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    vi.mocked(batteriesRepo.insertBattery).mockResolvedValueOnce({ id: 'old-new', custodian: 'customer', dealerId: 'dealer-1', replacedById: null } as never).mockResolvedValueOnce({ id: 'new-1' } as never);
    vi.mocked(batteriesRepo.insertChain).mockResolvedValue({ id: 'chain-old' } as never);
    vi.mocked(batteriesRepo.updateBatteryChainId).mockResolvedValue({ id: 'old-new', chainId: 'chain-old', custodian: 'customer', dealerId: 'dealer-1', replacedById: null } as never);
    vi.mocked(batteriesRepo.findChainById).mockResolvedValue({ id: 'chain-old', warrantyStart: '2026-01-01', warrantyExpiry: '2028-08-31', replacementCount: 0 } as never);
    vi.mocked(claimsRepo.insertClaim).mockResolvedValue({ id: 'claim-1', ref: 'CLM-26-09-0001' } as never);
    vi.mocked(repo.updateEntryStatus).mockResolvedValue({ id: 'entry-1', status: 'approved' } as never);

    const result = await approve(adminCtx, 'entry-1', 'ok');

    // the label prefix named the old battery's model; 30 + 2 months from Jan 2026
    expect(batteriesRepo.insertBattery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ batteryCode: 'M220026010047', modelId: 'M2200', notOnRecord: true }));
    expect(batteriesRepo.insertChain).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ warrantyStart: '2026-01-01', warrantyExpiry: '2028-08-31' }));
    expect(result.items[0]).toMatchObject({ newBattery: { id: 'new-1' }, claim: { id: 'claim-1' } });
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

  // A sales return runs the same course as a replacement from approval on: a claim is raised,
  // the battery is checked, head office decides, and the same battery comes home working
  // (client, 3 Oct 2026).
  it('raises a claim of its own kind — no warranty chain, no new battery', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ id: 'entry-1', status: 'submitted', dealerId: 'dealer-1', entryType: 'sales_return', entryDate: '2026-09-17' } as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([{ id: 'item-1', seq: 0, modelId: 'M5', batteryCode: 'M526041212', batteryCodeEntered: '26041212' }] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue({ id: 'batt-1', state: 'sold', custodian: 'customer', dealerId: 'dealer-1' } as never);
    vi.mocked(claimsRepo.insertClaim).mockResolvedValue({ id: 'claim-sr', ref: 'CLM-26-10-0009' } as never);
    vi.mocked(repo.updateEntryStatus).mockResolvedValue({ id: 'entry-1', status: 'approved' } as never);

    const result = await approve(adminCtx, 'entry-1', 'ok');

    expect(claimsRepo.insertClaim).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'sales_return', dealerId: 'dealer-1', oldBatteryId: 'batt-1',
    }));
    // a sales-return claim names no chain and no new battery: there is only the one battery
    const sent = vi.mocked(claimsRepo.insertClaim).mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(sent.chainId).toBeUndefined();
    expect(sent.newBatteryId).toBeUndefined();
    expect(result.items[0]).toMatchObject({ claim: { id: 'claim-sr' } });
    expect(repo.updateEntryItemLinks).toHaveBeenCalledWith(expect.anything(), 'item-1', { batteryId: 'batt-1', claimId: 'claim-sr' });
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

  // A battery is stored as its whole label (plate + model + digits). To split one back into the
  // digits — which is all a correction edits — the reader needs the product each half hangs off,
  // and the old battery can be a different product from the new one. Head office's correction box
  // mangled serials for want of it (client, 3 Oct 2026).
  it("sends each item's product, and the old battery's own product with it", async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ id: 'entry-1', dealerId: 'dealer-1' } as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([
      { id: 'i1', modelId: 'GPI700', batteryCode: 'GPI700260945678', oldModelId: 'G400', oldBatteryCode: 'G40026012145' },
    ] as never);

    const [item] = (await getById(dealerCtx, 'entry-1')).items;

    expect(item).toMatchObject({ modelId: 'GPI700', oldModelId: 'G400' });
  });
});

describe('list', () => {
  it("scopes a shop to its own requests — a distributor also reads his dealers' — ignoring what's asked", async () => {
    vi.mocked(repo.listEntries).mockResolvedValue({ items: [], nextCursor: null } as never);

    await list(dealerCtx, { limit: 50, dealerId: 'dealer-9' } as never);
    expect(repo.listEntries).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ dealerIds: ['dealer-1', 'dealer-1a'] }));

    await list({ ...dealerCtx, user: { ...dealerCtx.user!, dealerId: 'dealer-1a' } }, { limit: 50 });
    expect(repo.listEntries).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ dealerIds: ['dealer-1a'] }));
  });

  it('does not scope an admin caller to any dealer', async () => {
    vi.mocked(repo.listEntries).mockResolvedValue({ items: [], nextCursor: null } as never);

    await list(adminCtx, { limit: 50 });

    expect(repo.listEntries).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: undefined }));
  });
});

describe('replacement decisions wait for the old battery to reach the factory', () => {
  const entry = { id: 'entry-1', ref: 'ENT-26-09-0002', status: 'submitted', dealerId: 'dealer-1', entryType: 'replacement', entryDate: '2026-09-17' };
  const item = { id: 'item-1', seq: 0, modelId: 'M5', batteryCode: '26090001', oldBatteryCode: '26010099', claimId: null };

  it('approve refuses a replacement while its old battery is still on the way', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(returnsRepo.findLinesByEntryItemIds).mockResolvedValue([{ entryItemId: 'item-1', stage: 'in_transit' }] as never);

    await expect(approve(adminCtx, 'entry-1', 'ok')).rejects.toMatchObject({ code: 'old_battery_not_arrived', status: 409 });
    expect(repo.updateEntryStatus).not.toHaveBeenCalled();
  });

  it('approve refuses a replacement that was never dispatched', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(returnsRepo.findLinesByEntryItemIds).mockResolvedValue([] as never);

    await expect(approve(adminCtx, 'entry-1', 'ok')).rejects.toMatchObject({ code: 'old_battery_not_arrived' });
  });

  it('settle refuses a submitted replacement on arrival without raising a claim', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(repo.updateEntryStatus).mockResolvedValue({ id: 'entry-1', status: 'rejected' } as never);

    const r = await settle(adminCtx, 'entry-1', { decision: 'refused', reason: 'Physical damage on inspection' });

    expect(repo.updateEntryStatus).toHaveBeenCalledWith(expect.anything(), 'entry-1', expect.objectContaining({ status: 'rejected' }));
    expect(r.creditNotes).toEqual([]);
    expect(claimsService.decide).not.toHaveBeenCalled();
  });

  it('settle approves an already-approved entry: carries its claim from received through check to approved and returns the credit note', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...entry, status: 'approved' } as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([{ ...item, claimId: 'claim-1' }] as never);
    vi.mocked(claimsRepo.findClaimById).mockResolvedValue({ id: 'claim-1', status: 'received' } as never);
    vi.mocked(claimsService.check).mockResolvedValue({ id: 'claim-1', status: 'checked' } as never);
    vi.mocked(claimsService.decide).mockResolvedValue({ claim: { id: 'claim-1', status: 'approved' }, creditNote: { no: 'CN-26-09-0009', amount: null } } as never);

    const r = await settle(adminCtx, 'entry-1', { decision: 'approved', reason: 'Verified at the factory' });

    expect(claimsService.check).toHaveBeenCalledWith(adminCtx, 'claim-1', expect.objectContaining({ disqualify: false, disposition: 'hold' }));
    expect(claimsService.decide).toHaveBeenCalledWith(adminCtx, 'claim-1', { outcome: 'approved', reason: 'Verified at the factory' });
    expect(r.creditNotes).toEqual([{ no: 'CN-26-09-0009', amount: null }]);
  });

  it('settle moves a claim still marked raised through dispatch and receive before deciding', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...entry, status: 'approved' } as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([{ ...item, claimId: 'claim-1' }] as never);
    vi.mocked(claimsRepo.findClaimById).mockResolvedValue({ id: 'claim-1', status: 'raised' } as never);
    vi.mocked(claimsService.dispatch).mockResolvedValue({ id: 'claim-1', status: 'awaiting_return' } as never);
    vi.mocked(claimsService.receive).mockResolvedValue({ id: 'claim-1', status: 'received' } as never);
    vi.mocked(claimsService.check).mockResolvedValue({ id: 'claim-1', status: 'refused' } as never);

    await settle(adminCtx, 'entry-1', { decision: 'refused', reason: 'Not a manufacturing fault' });

    expect(claimsService.dispatch).toHaveBeenCalled();
    expect(claimsService.receive).toHaveBeenCalled();
    expect(claimsService.check).toHaveBeenCalledWith(adminCtx, 'claim-1', expect.objectContaining({ disqualify: true, reason: 'Not a manufacturing fault' }));
  });

  describe('one battery of several, decided on its own (itemId)', () => {
    const two = [{ ...item, claimId: 'claim-1' }, { ...item, id: 'item-2', seq: 1, batteryCode: '26090002', oldBatteryCode: '26010098', claimId: 'claim-2' }];

    it('needs only THAT battery to have arrived, and decides only its claim', async () => {
      vi.mocked(repo.findEntryById).mockResolvedValue({ ...entry, status: 'approved' } as never);
      vi.mocked(repo.findItemsByEntryId).mockResolvedValue(two as never);
      vi.mocked(returnsRepo.findLinesByEntryItemIds).mockResolvedValue([{ entryItemId: 'item-2', stage: 'received' }] as never);
      vi.mocked(claimsRepo.findClaimById).mockResolvedValue({ id: 'claim-2', status: 'checked' } as never);
      vi.mocked(claimsService.decide).mockResolvedValue({ claim: { id: 'claim-2', status: 'approved' }, creditNote: { no: 'CN-1', amount: null } } as never);

      await settle(adminCtx, 'entry-1', { decision: 'approved', reason: 'Verified', itemId: 'item-2' });

      expect(returnsRepo.findLinesByEntryItemIds).toHaveBeenCalledWith(expect.anything(), ['item-2']); // item-1 may still be on the way
      expect(claimsRepo.findClaimById).toHaveBeenCalledTimes(1);
      expect(claimsService.decide).toHaveBeenCalledWith(adminCtx, 'claim-2', { outcome: 'approved', reason: 'Verified' });
    });

    it('refusing one battery of a submitted request approves the request and refuses only that claim', async () => {
      vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
      vi.mocked(repo.findItemsByEntryId).mockResolvedValue(two as never);
      vi.mocked(returnsRepo.findLinesByEntryItemIds).mockResolvedValue([{ entryItemId: 'item-1', stage: 'received' }] as never);
      vi.mocked(claimsRepo.findClaimById).mockResolvedValue({ id: 'claim-1', status: 'received' } as never);

      await settle(adminCtx, 'entry-1', { decision: 'refused', reason: 'Physical damage', itemId: 'item-1' }).catch(() => {});

      expect(repo.updateEntryStatus).not.toHaveBeenCalledWith(expect.anything(), 'entry-1', expect.objectContaining({ status: 'rejected' }));
      expect(returnsRepo.findLinesByEntryItemIds).toHaveBeenCalledWith(expect.anything(), ['item-1']);
      expect(batteriesRepo.findBatteryByCode).toHaveBeenCalled(); // the request's approval ran (stock, chains, claims)
    });

    it('a battery that is not on the request is refused', async () => {
      vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
      vi.mocked(repo.findItemsByEntryId).mockResolvedValue(two as never);
      await expect(settle(adminCtx, 'entry-1', { decision: 'approved', reason: 'ok', itemId: 'item-9' })).rejects.toMatchObject({ code: 'item_not_found', status: 404 });
    });
  });

  it('settle only takes replacements', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...entry, entryType: 'sales_return' } as never);
    await expect(settle(adminCtx, 'entry-1', { decision: 'approved', reason: 'ok' })).rejects.toMatchObject({ code: 'not_a_replacement' });
  });
});

describe('photos the dealer attached (D-10)', () => {
  const entry = { id: 'entry-1', ref: 'ENT-26-10-0003', status: 'submitted', dealerId: 'dealer-1', entryType: 'replacement' };
  const items = [{ id: 'item-1', seq: 0 }, { id: 'item-2', seq: 1 }];
  const jpeg = Buffer.from('fake-jpeg-bytes').toString('base64');

  it('stores the photo in the bucket and records which battery it shows', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue(items as never);
    vi.mocked(repo.upsertPhoto).mockImplementation(async (_db, row) => ({ id: 'photo-1', createdAt: new Date(), ...row }) as never);

    const r = await addPhoto(dealerCtx, 'entry-1', { tag: 'New label', itemSeq: 1, contentType: 'image/jpeg', data: jpeg });

    expect(putObject).toHaveBeenCalledWith(expect.stringMatching(/^entries\/entry-1\/[0-9a-f-]+\.jpg$/), expect.any(Uint8Array), 'image/jpeg');
    expect(repo.upsertPhoto).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entryId: 'entry-1', entryItemId: 'item-2', tag: 'New label', sizeBytes: 15, uploadedBy: 'user-1' }));
    expect(r).toMatchObject({ id: 'photo-1', itemSeq: 1 });
  });

  it("a dealer cannot add to, or read, another dealer's request", async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    await expect(addPhoto(otherDealerCtx, 'entry-1', { tag: 'New label', contentType: 'image/jpeg', data: jpeg })).rejects.toMatchObject({ code: 'entry_not_found', status: 404 });
    await expect(listPhotos(otherDealerCtx, 'entry-1')).rejects.toMatchObject({ code: 'entry_not_found' });
    expect(putObject).not.toHaveBeenCalled();
  });

  it('a battery that is not on the request is refused before anything is stored', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue(items as never);
    await expect(addPhoto(dealerCtx, 'entry-1', { tag: 'New label', itemSeq: 5, contentType: 'image/jpeg', data: jpeg })).rejects.toMatchObject({ code: 'item_not_found' });
    expect(putObject).not.toHaveBeenCalled();
  });

  it('head office gets every photo with its battery and a signed link', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue(items as never);
    vi.mocked(repo.findPhotosByEntryId).mockResolvedValue([{ id: 'photo-1', entryItemId: 'item-2', tag: 'New label', objectKey: 'entries/entry-1/a.jpg', contentType: 'image/jpeg', sizeBytes: 15, createdAt: new Date() }] as never);

    const r = await listPhotos(adminCtx, 'entry-1');

    expect(r.items).toEqual([expect.objectContaining({ id: 'photo-1', itemId: 'item-2', itemSeq: 1, tag: 'New label', url: 'https://storage.example/entries/entry-1/a.jpg?sig=1' })]);
  });
});

describe('one battery at a time — review and correct', () => {
  const entry = { id: 'entry-1', ref: 'ENT-26-09-0114', entryType: 'replacement', status: 'submitted' };
  const item = { id: 'item-1', entryId: 'entry-1', seq: 0, modelId: 'M5', batteryCode: 'M526090001', batteryCodeEntered: '26090001',
    oldBatteryCode: 'M526040001', oldBatteryCodeEntered: '26040001', oldModelId: 'M5', reviewStartedAt: null };

  beforeEach(() => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemById).mockResolvedValue(item as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(repo.updateEntryItem).mockImplementation((async (_tx: unknown, id: string, set: object) => ({ ...item, id, ...set })) as never);
    vi.mocked(batteriesRepo.findModelById).mockImplementation((async (_db: unknown, id: string) =>
      (['M5', 'M2200', 'N2200'].includes(id) ? { id, warrantyMonths: 24, active: true } : undefined)) as never);
  });

  it('marks ONE battery as under review, leaving the request and the other batteries alone', async () => {
    const r = await reviewItem(adminCtx, 'entry-1', 'item-1', { note: 'Opening it on the bench' });
    expect(r.reviewStartedAt).toEqual(now());
    expect(r.reviewStartedBy).toBe('admin-1');
    expect(r.reviewNote).toBe('Opening it on the bench');
    // the ENTRY is untouched: a review is a note about work, not a decision
    expect(repo.updateEntryStatus).not.toHaveBeenCalled();
  });

  it('a dealer cannot review or correct a battery', async () => {
    await expect(reviewItem(dealerCtx, 'entry-1', 'item-1', {})).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(correctItem(dealerCtx, 'entry-1', 'item-1', { code: '26090002', reason: 'typo' })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('an item id from another request is refused, not silently acted on', async () => {
    vi.mocked(repo.findItemById).mockResolvedValue({ ...item, entryId: 'entry-OTHER' } as never);
    await expect(reviewItem(adminCtx, 'entry-1', 'item-1', {})).rejects.toMatchObject({ code: 'item_not_found' });
  });

  it('approving ONE battery does not lock the others — that is the whole point', async () => {
    // approving a battery flips the request to 'approved'; its siblings are still undecided
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...entry, status: 'approved' } as never);
    await expect(reviewItem(adminCtx, 'entry-1', 'item-1', {})).resolves.toBeTruthy();
    await expect(correctItem(adminCtx, 'entry-1', 'item-1', { code: '26090002', reason: 'typo' })).resolves.toBeTruthy();
  });

  it('a battery already put on record cannot have its number rewritten', async () => {
    vi.mocked(repo.findItemById).mockResolvedValue({ ...item, batteryId: 'bat-1' } as never);
    await expect(correctItem(adminCtx, 'entry-1', 'item-1', { code: '26090002', reason: 'typo' })).rejects.toMatchObject({ code: 'already_on_record' });
  });

  it('a refused request has nothing left to change', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...entry, status: 'rejected' } as never);
    await expect(correctItem(adminCtx, 'entry-1', 'item-1', { code: '26090002', reason: 'typo' })).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('corrects one battery, rewriting its code and recording who and why', async () => {
    const r = await correctItem(adminCtx, 'entry-1', 'item-1', { code: '26090099', reason: 'Dealer read the label wrong' });
    expect(r.batteryCode).toBe('M526090099');
    expect(r.batteryCodeEntered).toBe('26090099');
    expect(r.oldBatteryCode).toBe('M526040001'); // untouched — only the new battery was corrected
    expect(r.correctedBy).toBe('admin-1');
    expect(r.correctionReason).toBe('Dealer read the label wrong');
  });

  // The plate and model can be wrong too, not only the digits: a dealer picks the model from a
  // list and can pick the one above it (client, 3 Oct 2026).
  it('corrects the plate and model, keeping the digits the dealer sent', async () => {
    const r = await correctItem(adminCtx, 'entry-1', 'item-1', { modelId: 'M2200', reason: 'Dealer chose the wrong model' });
    expect(r.batteryCode).toBe('M220026090001');  // same digits, under the right product
    expect(r.modelId).toBe('M2200');
    expect(r.oldBatteryCode).toBe('M526040001');  // the old battery is left alone
  });

  it("corrects the OLD battery's plate and model on its own", async () => {
    const r = await correctItem(adminCtx, 'entry-1', 'item-1', { oldModelId: 'M2200', reason: 'Old battery is another product' });
    expect(r.oldBatteryCode).toBe('M220026040001');
    expect(r.oldModelId).toBe('M2200');
    expect(r.batteryCode).toBe('M526090001');
  });

  // The console sends the digits on their own and the model as its own field. If the stored
  // "as entered" value happens to carry a model prefix, deriving the model from it would quietly
  // undo the model head office just picked.
  it('an explicit model wins over one read out of the stored code', async () => {
    vi.mocked(repo.findItemById).mockResolvedValue({ ...item, batteryCodeEntered: 'M5-26090001' } as never);
    const r = await correctItem(adminCtx, 'entry-1', 'item-1', { modelId: 'M2200', reason: 'Dealer chose the wrong model' });
    expect(r.modelId).toBe('M2200');
    expect(r.batteryCode).toBe('M220026090001');
  });

  it('corrects only the OLD battery when that is what was wrong', async () => {
    const r = await correctItem(adminCtx, 'entry-1', 'item-1', { oldCode: '26040077', reason: 'Old serial mistyped' });
    expect(r.oldBatteryCode).toBe('M526040077');
    expect(r.batteryCode).toBe('M526090001'); // the new battery is left exactly as the dealer sent it
  });

  it('a correction is held to the same rules as the original entry', async () => {
    // a new battery must still be 7, 8 or 9 digits
    await expect(correctItem(adminCtx, 'entry-1', 'item-1', { code: '260900', reason: 'too short' }))
      .rejects.toMatchObject({ code: 'format_mismatch', field: 'code' });
    // ...and must still carry a month that exists
    await expect(correctItem(adminCtx, 'entry-1', 'item-1', { code: '26990001', reason: 'bad month' }))
      .rejects.toMatchObject({ code: 'format_mismatch' });
    // ...and cannot be made the same battery as the old one
    await expect(correctItem(adminCtx, 'entry-1', 'item-1', { code: '26040001', reason: 'same as old' }))
      .rejects.toMatchObject({ code: 'old_equals_new' });
    // ...and cannot collide with another battery already on this request
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item, { ...item, id: 'item-2', batteryCode: 'M526090099' }] as never);
    await expect(correctItem(adminCtx, 'entry-1', 'item-1', { code: '26090099', reason: 'clash' }))
      .rejects.toMatchObject({ code: 'duplicate_serial' });
  });

  it('a correction naming a model the factory does not make is refused', async () => {
    await expect(correctItem(adminCtx, 'entry-1', 'item-1', { code: '26090002', modelId: 'NOPE', reason: 'unknown model' }))
      .rejects.toMatchObject({ code: 'model_unknown' });
  });
});

describe("approving a battery is the verdict, not the refund (client, 2 Oct 2026)", () => {
  const entry = { id: 'entry-1', ref: 'ENT-26-10-0014', entryType: 'replacement', status: 'approved', dealerId: 'dealer-1' };
  const items = [{ id: 'item-1', entryId: 'entry-1', seq: 0, claimId: 'cl-1', oldBatteryCode: 'M526040001' }];
  beforeEach(() => {
    vi.mocked(repo.findEntryById).mockResolvedValue(entry as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue(items as never);
    vi.mocked(returnsRepo.findLinesByEntryItemIds).mockResolvedValue([{ entryItemId: 'item-1', stage: 'received' }] as never);
    vi.mocked(claimsRepo.findClaimById).mockResolvedValue({ id: 'cl-1', status: 'received' } as never);
    vi.mocked(claimsService.check).mockResolvedValue({ id: 'cl-1', status: 'checked' } as never);
    vi.mocked(claimsService.decide).mockResolvedValue({ claim: { id: 'cl-1' }, creditNote: { no: 'CN-1' } } as never);
  });

  it("'passed' checks the battery and stops — the Claim button does the rest", async () => {
    const r = await settle(adminCtx, 'entry-1', { decision: 'passed', reason: 'Checked on the bench — defect confirmed', itemId: 'item-1' });
    expect(claimsService.check).toHaveBeenCalled();
    expect(claimsService.decide).not.toHaveBeenCalled(); // not approved for refund yet
    expect(r.creditNotes).toEqual([]);
  });

  it("'approved' still does both, for a battery decided on its own", async () => {
    await settle(adminCtx, 'entry-1', { decision: 'approved', reason: 'Checked and approved together', itemId: 'item-1' });
    expect(claimsService.check).toHaveBeenCalled();
    expect(claimsService.decide).toHaveBeenCalledWith(adminCtx, 'cl-1', expect.objectContaining({ outcome: 'approved' }));
  });
});

describe("a dealer's request goes to its distributor first (client, 2 Oct 2026)", () => {
  const childCtx: Ctx = { ...dealerCtx, user: { ...dealerCtx.user!, id: 'user-1a', dealerId: 'dealer-1a' } };
  const waiting = { id: 'entry-9', ref: 'ENT-26-10-0009', status: 'with_distributor', dealerId: 'dealer-1a', entryType: 'replacement' };

  it("a dealer's request starts with its distributor; a distributor's own goes straight to head office", async () => {
    vi.mocked(repo.insertEntry).mockResolvedValue({ id: 'entry-x', ref: 'ENT-26-10-0010' } as never);
    vi.mocked(repo.insertEntryItem).mockResolvedValue({ id: 'item-x' } as never);
    await create(childCtx, baseBody({ items: [repItem({ code: '26091234' })] } as never));
    expect(repo.insertEntry).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ dealerId: 'dealer-1a', status: 'with_distributor' }));
    await create(dealerCtx, baseBody({ items: [repItem({ code: '26091235', oldCode: '26030779' })] } as never));
    expect(repo.insertEntry).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ dealerId: 'dealer-1', status: 'submitted' }));
  });

  it('the distributor approves it on to head office, with his reason recorded', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(waiting as never);
    vi.mocked(repo.setDistributorDecision).mockResolvedValue({ ...waiting, status: 'submitted' } as never);
    const r = await distributorDecide(dealerCtx, 'entry-9', 'approve', 'Battery checked at my shop');
    expect(repo.setDistributorDecision).toHaveBeenCalledWith(expect.anything(), 'entry-9', { approve: true, by: 'user-1', reason: 'Battery checked at my shop' });
    expect(r.status).toBe('submitted');
  });

  it('or refuses it, which ends it with the reason the dealer sees', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(waiting as never);
    vi.mocked(repo.setDistributorDecision).mockResolvedValue({ ...waiting, status: 'rejected' } as never);
    await distributorDecide(dealerCtx, 'entry-9', 'refuse', 'Physical damage, not covered');
    expect(repo.setDistributorDecision).toHaveBeenCalledWith(expect.anything(), 'entry-9', expect.objectContaining({ approve: false }));
  });

  it("only HIS dealers' requests, only while they wait, and never by a dealer", async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...waiting, dealerId: 'dealer-2a' } as never);
    await expect(distributorDecide(dealerCtx, 'entry-9', 'approve', 'Looks right to me')).rejects.toMatchObject({ code: 'entry_not_found', status: 404 });
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...waiting, status: 'submitted' } as never);
    await expect(distributorDecide(dealerCtx, 'entry-9', 'approve', 'Looks right to me')).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(distributorDecide(childCtx, 'entry-9', 'approve', 'Approving my own')).rejects.toMatchObject({ code: 'distributor_only' });
    expect(repo.setDistributorDecision).not.toHaveBeenCalled();
  });

  it('head office cannot decide a request that is still with the distributor', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(waiting as never);
    await expect(approve(adminCtx, 'entry-9', 'ok')).rejects.toMatchObject({ code: 'with_distributor', status: 409 });
    await expect(settle(adminCtx, 'entry-9', { decision: 'approved', reason: 'Verified' })).rejects.toMatchObject({ code: 'with_distributor' });
    await expect(reject(adminCtx, 'entry-9', 'Not covered')).rejects.toMatchObject({ code: 'with_distributor' });
  });
});

describe('each tier sees only the party it deals with (client, 3 Oct 2026)', () => {
  const row = { id: 'e1', ref: 'ENT-26-10-0001', dealerId: 'dealer-1', customerName: 'Ayan', status: 'submitted' };
  beforeEach(() => {
    vi.mocked(repo.findEntryById).mockResolvedValue(row as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([] as never);
    vi.mocked(repo.listEntries).mockResolvedValue({ items: [row], nextCursor: null } as never);
  });

  it("the shop that recorded it still sees its own customer", async () => {
    const r = await getById(dealerCtx, 'e1');
    expect(r.customerName).toBe('Ayan');
  });

  it('head office never receives the customer name', async () => {
    expect((await getById(adminCtx, 'e1')).customerName).toBeNull();
    expect((await list(adminCtx, { limit: 50 } as never)).items[0]!.customerName).toBeNull();
  });

  it("a distributor reading a dealer's request sees the dealer, not the dealer's customer", async () => {
    // dealer-1 is the distributor in these fixtures; dealer-1a is a shop beneath it
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...row, dealerId: 'dealer-1a' } as never);
    const r = await getById(dealerCtx, 'e1');
    expect(r.customerName).toBeNull();     // the dealer's customer is the dealer's business
    expect(r.dealerId).toBe('dealer-1a');  // but which shop it came from stays visible
  });
});

describe("the distributor marks a dealer's old battery arrived (client, 3 Oct 2026)", () => {
  const childCtx: Ctx = { ...dealerCtx, user: { ...dealerCtx.user!, id: 'user-1a', dealerId: 'dealer-1a' } };
  const approvedByHim = { id: 'entry-7', ref: 'ENT-26-10-0007', status: 'submitted', dealerId: 'dealer-1a', entryType: 'replacement' };
  const items = [{ id: 'item-1', seq: 0, oldBatteryCode: 'M526040001', distributorReceivedAt: null }, { id: 'item-2', seq: 1, oldBatteryCode: 'M526040002', distributorReceivedAt: null }];

  it('marks every battery still to come, after he approved the request, with an audit row each', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(approvedByHim as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue(items as never);
    vi.mocked(repo.updateEntryItem).mockImplementation(async (_tx, id, set) => ({ id, ...set }) as never);
    const r = await markArrived(dealerCtx, 'entry-7');
    expect(repo.updateEntryItem).toHaveBeenCalledTimes(2);
    expect(repo.updateEntryItem).toHaveBeenCalledWith(expect.anything(), 'item-1', expect.objectContaining({ distributorReceivedBy: 'user-1', distributorReceivedAt: expect.any(Date) }));
    expect(r.items).toHaveLength(2);
  });

  it('or one battery of several', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(approvedByHim as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue(items as never);
    vi.mocked(repo.updateEntryItem).mockImplementation(async (_tx, id, set) => ({ id, ...set }) as never);
    await markArrived(dealerCtx, 'entry-7', 'item-2');
    expect(repo.updateEntryItem).toHaveBeenCalledTimes(1);
    expect(repo.updateEntryItem).toHaveBeenCalledWith(expect.anything(), 'item-2', expect.anything());
  });

  it('not before he approved it, not twice, not by a dealer, not for another distributor\'s dealer', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...approvedByHim, status: 'with_distributor' } as never);
    await expect(markArrived(dealerCtx, 'entry-7')).rejects.toMatchObject({ code: 'not_approved_yet' });
    vi.mocked(repo.findEntryById).mockResolvedValue(approvedByHim as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue(items.map((it) => ({ ...it, distributorReceivedAt: new Date() })) as never);
    await expect(markArrived(dealerCtx, 'entry-7', 'item-1')).rejects.toMatchObject({ code: 'already_arrived', status: 409 });
    await expect(markArrived(childCtx, 'entry-7')).rejects.toMatchObject({ code: 'distributor_only' });
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...approvedByHim, dealerId: 'dealer-2a' } as never);
    await expect(markArrived(dealerCtx, 'entry-7')).rejects.toMatchObject({ code: 'entry_not_found', status: 404 });
    expect(repo.updateEntryItem).not.toHaveBeenCalled();
  });
});

describe('special replacement requests — old battery past its term (client, 3 Oct 2026)', () => {
  // today is 17 Sep 2026. An M5 has a 24-month term + 2 grace months, counted from manufacture.
  const rep = (oldCode: string) => baseBody({ entryType: 'replacement', items: [{ modelId: 'M5', code: '26090001', oldCode, oldModelId: 'M5', faultCode: 'low_backup' }] } as never);
  const childCtx: Ctx = { ...dealerCtx, user: { ...dealerCtx.user!, id: 'user-1a', dealerId: 'dealer-1a' } };
  const item = { id: 'item-1', seq: 0, modelId: 'M5', batteryCode: 'M526090001', batteryCodeEntered: '26090001', oldBatteryCode: 'M524010047', oldBatteryCodeEntered: '24010047', batteryId: null };
  const special = { id: 'entry-5', ref: 'ENT-26-09-0005', status: 'submitted', specialStatus: 'pending', dealerId: 'dealer-1a', entryType: 'replacement', entryDate: '2026-09-17' };

  beforeEach(() => {
    vi.mocked(repo.insertEntry).mockImplementation(async (_tx, input) => ({ ...input, id: 'entry-5' }) as never);
  });

  it('a battery within its term is a normal request', async () => {
    await create(dealerCtx, rep('26010047'));
    expect(repo.insertEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ specialStatus: null }));
    expect(repo.insertEntryItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ coverCase: null }));
  });

  it('inside the 2 grace months it is a special request, judged on the server', async () => {
    // made Aug 2024: the 24-month term ended 31 Jul 2026, the cover ends 30 Sep 2026
    await create(dealerCtx, rep('24080047'));
    expect(repo.insertEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ specialStatus: 'pending', status: 'submitted' }));
    expect(repo.insertEntryItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ coverCase: 'extension', coverTermEnd: '2026-07-31', coverEnd: '2026-09-30' }));
  });

  it('past the cover it is a special request too, with no limit on the days — and a dealer still goes through his distributor', async () => {
    await create(childCtx, rep('21030047'));
    expect(repo.insertEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ specialStatus: 'pending', status: 'with_distributor' }));
    expect(repo.insertEntryItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ coverCase: 'expired', coverEnd: '2023-04-30' }));
  });

  it('a battery on record is judged on its chain, not its label', async () => {
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue({ id: 'old-1', chainId: 'chain-1', noWarranty: false } as never);
    vi.mocked(batteriesRepo.findChainById).mockResolvedValue({ id: 'chain-1', warrantyStart: '2024-08-10', warrantyExpiry: '2026-10-09', termMonths: 24 } as never);
    await create(dealerCtx, rep('26010047')); // the label alone would say "within the term"
    expect(repo.insertEntryItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ coverCase: 'extension', coverTermEnd: '2026-08-09' }));
  });

  it('a battery that was itself given with no warranty can never be replaced', async () => {
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue({ id: 'old-1', chainId: 'chain-1', noWarranty: true, noWarrantyReason: 'given on 2026-08-01 as a special replacement' } as never);
    await expect(create(dealerCtx, rep('26010047'))).rejects.toMatchObject({ code: 'no_warranty', status: 422 });
    expect(repo.insertEntry).not.toHaveBeenCalled();
  });

  it('head office cannot approve, settle or refuse it the normal way until it is decided in Correction requests', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(special as never);
    await expect(approve(adminCtx, 'entry-5', 'ok')).rejects.toMatchObject({ code: 'special_pending', status: 409 });
    await expect(settle(adminCtx, 'entry-5', { decision: 'approved', reason: 'Verified' })).rejects.toMatchObject({ code: 'special_pending' });
    await expect(reject(adminCtx, 'entry-5', 'No')).rejects.toMatchObject({ code: 'special_pending' });
  });

  it('only head office decides it, only once, and only after the distributor approved it', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(special as never);
    await expect(decideSpecial(dealerCtx, 'entry-5', 'approve', 'Looks fine')).rejects.toMatchObject({ code: 'unauthenticated' });
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...special, status: 'with_distributor' } as never);
    await expect(decideSpecial(adminCtx, 'entry-5', 'approve', 'Looks fine')).rejects.toMatchObject({ code: 'with_distributor' });
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...special, specialStatus: 'approved' } as never);
    await expect(decideSpecial(adminCtx, 'entry-5', 'reject', 'Changed my mind')).rejects.toMatchObject({ code: 'invalid_transition' });
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...special, specialStatus: null } as never);
    await expect(decideSpecial(adminCtx, 'entry-5', 'approve', 'Looks fine')).rejects.toMatchObject({ code: 'not_special' });
    expect(repo.setSpecialDecision).not.toHaveBeenCalled();
  });

  it('approving opens the way and puts nothing on record yet', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(special as never);
    vi.mocked(repo.setSpecialDecision).mockResolvedValue({ ...special, specialStatus: 'approved' } as never);
    const r = await decideSpecial(adminCtx, 'entry-5', 'approve', 'Photos and dates checked');
    expect(repo.setSpecialDecision).toHaveBeenCalledWith(expect.anything(), 'entry-5', { approve: true, by: 'admin-1', reason: 'Photos and dates checked' });
    expect(r.specialStatus).toBe('approved');
    expect(batteriesRepo.insertBattery).not.toHaveBeenCalled();
  });

  it('rejecting ends it and records the battery the customer already has with NO warranty', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(special as never);
    vi.mocked(repo.setSpecialDecision).mockResolvedValue({ ...special, status: 'rejected', specialStatus: 'rejected' } as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue(undefined);
    vi.mocked(batteriesRepo.insertBattery).mockResolvedValue({ id: 'new-1' } as never);
    await decideSpecial(adminCtx, 'entry-5', 'reject', 'Battery was sold separately');
    expect(batteriesRepo.insertBattery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ batteryCode: 'M526090001', noWarranty: true, custodian: 'customer', dealerId: 'dealer-1a' }));
    expect(repo.updateEntryItemLinks).toHaveBeenCalledWith(expect.anything(), 'item-1', { batteryId: 'new-1' });
  });

  it('a battery already on record under that number is left alone', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(special as never);
    vi.mocked(repo.setSpecialDecision).mockResolvedValue({ ...special, status: 'rejected', specialStatus: 'rejected' } as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue({ id: 'someone-elses' } as never);
    await decideSpecial(adminCtx, 'entry-5', 'reject', 'Not covered');
    expect(batteriesRepo.insertBattery).not.toHaveBeenCalled();
  });

  it("the distributor's refusal ends a special request the same way", async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...special, status: 'with_distributor' } as never);
    vi.mocked(repo.setDistributorDecision).mockResolvedValue({ ...special, status: 'rejected' } as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValue(undefined);
    vi.mocked(batteriesRepo.insertBattery).mockResolvedValue({ id: 'new-1' } as never);
    await distributorDecide(dealerCtx, 'entry-5', 'refuse', 'Not a genuine fault');
    expect(repo.setSpecialDecision).toHaveBeenCalledWith(expect.anything(), 'entry-5', expect.objectContaining({ approve: false }));
    expect(batteriesRepo.insertBattery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ noWarranty: true }));
  });

  describe('once head office approved it, it is decided at the factory', () => {
    const approvedSpecial = { ...special, specialStatus: 'approved' };
    const oldOnRecord = { id: 'old-1', chainId: 'chain-1', custodian: 'customer', dealerId: 'dealer-1a', replacedById: null, noWarranty: false };
    beforeEach(() => {
      vi.mocked(repo.findEntryById).mockResolvedValue(approvedSpecial as never);
      vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
      vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValueOnce(oldOnRecord as never).mockResolvedValueOnce(undefined);
      vi.mocked(batteriesRepo.insertBattery).mockResolvedValue({ id: 'new-1' } as never);
      vi.mocked(claimsRepo.insertClaim).mockResolvedValue({ id: 'claim-1', ref: 'CLM-26-09-0001' } as never);
      vi.mocked(repo.updateEntryStatus).mockResolvedValue({ id: 'entry-5', status: 'approved' } as never);
    });

    it('past the cover: the new battery joins the chain but carries NO warranty', async () => {
      vi.mocked(batteriesRepo.findChainById).mockResolvedValue({ id: 'chain-1', warrantyStart: '2024-01-01', warrantyExpiry: '2026-02-28', replacementCount: 0 } as never);
      await approve(adminCtx, 'entry-5', 'Checked at the factory');
      expect(batteriesRepo.insertBattery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ batteryCode: 'M526090001', chainId: 'chain-1', noWarranty: true }));
    });

    it('inside the grace months: the new battery inherits the old end date, even with days left', async () => {
      vi.mocked(batteriesRepo.findChainById).mockResolvedValue({ id: 'chain-1', warrantyStart: '2024-08-01', warrantyExpiry: '2026-09-30', replacementCount: 0 } as never);
      await approve(adminCtx, 'entry-5', 'Checked at the factory');
      const inserted = vi.mocked(batteriesRepo.insertBattery).mock.calls[0]![1] as { chainId: string; noWarranty?: boolean };
      expect(inserted.chainId).toBe('chain-1');
      expect(inserted.noWarranty).toBeUndefined();
    });

    it('refused at the factory: no credit, and the new battery is recorded with no warranty', async () => {
      vi.mocked(batteriesRepo.findBatteryByCode).mockReset().mockResolvedValue(undefined);
      vi.mocked(repo.updateEntryStatus).mockResolvedValue({ id: 'entry-5', status: 'rejected' } as never);
      await reject(adminCtx, 'entry-5', 'Physical damage');
      expect(batteriesRepo.insertBattery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ noWarranty: true }));
    });
  });

  it('a past-cover replacement that is NOT an approved special request is still refused', async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue({ ...special, specialStatus: null } as never);
    vi.mocked(repo.findItemsByEntryId).mockResolvedValue([item] as never);
    vi.mocked(batteriesRepo.findBatteryByCode).mockResolvedValueOnce({ id: 'old-1', chainId: 'chain-1', custodian: 'customer', dealerId: 'dealer-1a', replacedById: null } as never);
    vi.mocked(batteriesRepo.findChainById).mockResolvedValue({ id: 'chain-1', warrantyStart: '2024-01-01', warrantyExpiry: '2026-02-28' } as never);
    await expect(approve(adminCtx, 'entry-5', 'ok')).rejects.toMatchObject({ code: 'warranty_expired' });
  });
});
