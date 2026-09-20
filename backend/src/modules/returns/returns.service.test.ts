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

vi.mock('../entries/entries.repository', () => ({
  findEntriesByIds: vi.fn(),
  findItemsByEntryIds: vi.fn(),
}));

vi.mock('./returns.repository', () => ({
  findChallanById: vi.fn(),
  findLinesByChallanId: vi.fn(),
  findLinesByChallanIds: vi.fn(),
  findLineById: vi.fn(),
  findLinesByEntryItemIds: vi.fn(),
  insertChallan: vi.fn(),
  insertLines: vi.fn(),
  markReceived: vi.fn(),
  updateLineStage: vi.fn(),
  listChallans: vi.fn(),
}));

import * as entriesRepo from '../entries/entries.repository';
import * as repo from './returns.repository';
import { dispatch, receive, stage } from './returns.service';
import type { Ctx } from '../../utils/context';

const now = () => new Date('2026-09-19T06:00:00Z');
const dealerCtx: Ctx = {
  user: { id: 'user-1', scope: 'dealer', role: 'dealer_manager', dealerId: 'dealer-1' },
  request: { id: 'req-1', ip: '127.0.0.1', deviceId: 'device-1', userAgent: 'vitest' },
  now,
};
const adminCtx: Ctx = { ...dealerCtx, user: { id: 'admin-1', scope: 'admin', role: 'main_admin' } };

const replacement = { id: 'entry-1', ref: 'ENT-26-09-0005', dealerId: 'dealer-1', entryType: 'replacement', status: 'submitted' };
const item = { id: 'item-1', entryId: 'entry-1', modelId: 'M5', batteryCode: '26020202', oldBatteryCode: '26030777', faultCode: 'not_holding_charge' };

beforeEach(() => vi.clearAllMocks());

describe('dispatch — a dealer hands old batteries to the van', () => {
  it('creates a challan with one line per old battery, before the entry is approved', async () => {
    vi.mocked(entriesRepo.findEntriesByIds).mockResolvedValue([replacement] as never);
    vi.mocked(entriesRepo.findItemsByEntryIds).mockResolvedValue([item] as never);
    vi.mocked(repo.findLinesByEntryItemIds).mockResolvedValue([]);
    vi.mocked(repo.insertChallan).mockResolvedValue({ id: 'chl-1', no: 'CHL-26-09-0001', status: 'dispatched' } as never);
    vi.mocked(repo.insertLines).mockImplementation(async (_tx, values) => values.map((v, i) => ({ id: `line-${i}`, stage: 'in_transit', ...v })) as never);

    const result = await dispatch(dealerCtx, { entryIds: ['entry-1'], vehicleNo: 'MH18AB1234' });
    expect(result.no).toBe('CHL-26-09-0001');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ batteryCode: '26030777', entryItemId: 'item-1', modelId: 'M5' });
    expect(vi.mocked(repo.insertChallan).mock.calls[0][1]).toMatchObject({ dealerId: 'dealer-1', vehicleNo: 'MH18AB1234', lineCount: 1, dispatchedBy: 'user-1' });
  });

  it('answers 404 (not 403) for another dealer\'s entry', async () => {
    vi.mocked(entriesRepo.findEntriesByIds).mockResolvedValue([{ ...replacement, dealerId: 'dealer-2' }] as never);
    await expect(dispatch(dealerCtx, { entryIds: ['entry-1'] })).rejects.toMatchObject({ code: 'entry_not_found', status: 404 });
  });

  it('refuses a sales return — there is no old battery', async () => {
    vi.mocked(entriesRepo.findEntriesByIds).mockResolvedValue([{ ...replacement, entryType: 'sales_return' }] as never);
    await expect(dispatch(dealerCtx, { entryIds: ['entry-1'] })).rejects.toMatchObject({ code: 'nothing_to_dispatch' });
  });

  it('refuses an old battery that is already on a challan', async () => {
    vi.mocked(entriesRepo.findEntriesByIds).mockResolvedValue([replacement] as never);
    vi.mocked(entriesRepo.findItemsByEntryIds).mockResolvedValue([item] as never);
    vi.mocked(repo.findLinesByEntryItemIds).mockResolvedValue([{ entryId: 'entry-1', batteryCode: '26030777' }] as never);
    await expect(dispatch(dealerCtx, { entryIds: ['entry-1'] })).rejects.toMatchObject({ code: 'already_dispatched', status: 409 });
  });

  it('is dealer-only', async () => {
    await expect(dispatch(adminCtx, { entryIds: ['entry-1'] })).rejects.toMatchObject({ code: 'permission_denied' });
  });
});

describe('receive — head office confirms the van arrived', () => {
  it('marks every line received, flagging the ones missing from the van', async () => {
    vi.mocked(repo.findChallanById).mockResolvedValue({ id: 'chl-1', no: 'CHL-26-09-0001', status: 'dispatched' } as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue([{ id: 'line-1', batteryCode: '26030777' }, { id: 'line-2', batteryCode: '26040101' }] as never);
    vi.mocked(repo.markReceived).mockResolvedValue({ id: 'chl-1', status: 'received' } as never);
    vi.mocked(repo.updateLineStage).mockImplementation(async (_tx, id, values) => ({ id, ...values }) as never);

    const result = await receive(adminCtx, 'chl-1', { missingBatteryCodes: ['26040101'] });
    expect(result.status).toBe('received');
    expect(result.lines).toEqual([
      expect.objectContaining({ id: 'line-1', stage: 'received', shortage: false }),
      expect.objectContaining({ id: 'line-2', stage: 'in_transit', shortage: true }),
    ]);
  });

  it('refuses a code that is not on the challan', async () => {
    vi.mocked(repo.findChallanById).mockResolvedValue({ id: 'chl-1', no: 'CHL-26-09-0001', status: 'dispatched' } as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue([{ id: 'line-1', batteryCode: '26030777' }] as never);
    await expect(receive(adminCtx, 'chl-1', { missingBatteryCodes: ['99999999'] })).rejects.toMatchObject({ code: 'line_not_on_challan' });
  });

  it('cannot be received twice', async () => {
    vi.mocked(repo.findChallanById).mockResolvedValue({ id: 'chl-1', no: 'CHL-26-09-0001', status: 'received' } as never);
    await expect(receive(adminCtx, 'chl-1', { missingBatteryCodes: [] })).rejects.toMatchObject({ code: 'challan_already_received' });
  });

  it('is head office only', async () => {
    await expect(receive(dealerCtx, 'chl-1', { missingBatteryCodes: [] })).rejects.toMatchObject({ code: 'permission_denied' });
  });
});

describe('stage — processing after arrival follows the chain', () => {
  it('received -> testing -> scrapped -> closed', async () => {
    vi.mocked(repo.updateLineStage).mockImplementation(async (_tx, id, values) => ({ id, ...values }) as never);
    vi.mocked(repo.findLineById).mockResolvedValueOnce({ id: 'line-1', stage: 'received', batteryCode: '26030777' } as never);
    expect((await stage(adminCtx, 'line-1', { stage: 'testing', reason: 'Bench test started' })).stage).toBe('testing');
    vi.mocked(repo.findLineById).mockResolvedValueOnce({ id: 'line-1', stage: 'testing', batteryCode: '26030777' } as never);
    expect((await stage(adminCtx, 'line-1', { stage: 'scrapped', reason: 'Cell dead, not repairable' })).stage).toBe('scrapped');
    vi.mocked(repo.findLineById).mockResolvedValueOnce({ id: 'line-1', stage: 'scrapped', batteryCode: '26030777' } as never);
    expect((await stage(adminCtx, 'line-1', { stage: 'closed', reason: 'Disposed with scrap lot 12' })).stage).toBe('closed');
  });

  it('refuses a skipped step', async () => {
    vi.mocked(repo.findLineById).mockResolvedValue({ id: 'line-1', stage: 'in_transit', batteryCode: '26030777' } as never);
    await expect(stage(adminCtx, 'line-1', { stage: 'closed', reason: 'Skipping ahead' })).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});
