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

vi.mock('../claims/claims.repository', () => ({ findClaimById: vi.fn() }));
vi.mock('../batteries/batteries.repository', () => ({ setBatteryPlant: vi.fn() }));
vi.mock('../masters/masters.repository', () => ({ findPlantById: vi.fn() }));
vi.mock('../claims/claims.service', () => ({ dispatch: vi.fn(), receive: vi.fn(), decide: vi.fn() }));

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
  setLinePlant: vi.fn(),
  listChallans: vi.fn(),
  listLines: vi.fn(),
  findClaimStateByEntryItemIds: vi.fn(),
}));

import * as batteriesRepo from '../batteries/batteries.repository';
import * as claimsRepo from '../claims/claims.repository';
import * as mastersRepo from '../masters/masters.repository';
import { audit } from '../../utils/audit';
import * as claimsService from '../claims/claims.service';
import * as entriesRepo from '../entries/entries.repository';
import * as repo from './returns.repository';
import { claimChecked, dispatch, getById, list, receive, receiveLine, setLinePlant, stage } from './returns.service';
import { ChallanReceiveBody, LineReceiveBody } from './returns.validation';
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
    expect(vi.mocked(repo.insertChallan).mock.calls[0]?.[1]).toMatchObject({ dealerId: 'dealer-1', vehicleNo: 'MH18AB1234', lineCount: 1, dispatchedBy: 'user-1' });
  });

  it('carries an already-raised claim to awaiting_return (stock ledger via the claims service)', async () => {
    vi.mocked(entriesRepo.findEntriesByIds).mockResolvedValue([{ ...replacement, status: 'approved' }] as never);
    vi.mocked(entriesRepo.findItemsByEntryIds).mockResolvedValue([{ ...item, claimId: 'claim-1' }] as never);
    vi.mocked(repo.findLinesByEntryItemIds).mockResolvedValue([]);
    vi.mocked(repo.insertChallan).mockResolvedValue({ id: 'chl-1', no: 'CHL-26-09-0001', status: 'dispatched' } as never);
    vi.mocked(repo.insertLines).mockResolvedValue([] as never);
    vi.mocked(claimsRepo.findClaimById).mockResolvedValue({ id: 'claim-1', status: 'raised' } as never);
    await dispatch(dealerCtx, { entryIds: ['entry-1'] });
    expect(claimsService.dispatch).toHaveBeenCalledWith(dealerCtx, 'claim-1');
    expect(claimsService.receive).not.toHaveBeenCalled();
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
    vi.mocked(mastersRepo.findPlantById).mockResolvedValue(MAIN as never);
    vi.mocked(repo.findChallanById).mockResolvedValue({ id: 'chl-1', no: 'CHL-26-09-0001', status: 'dispatched' } as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue([{ id: 'line-1', batteryCode: '26030777', stage: 'in_transit' }, { id: 'line-2', batteryCode: '26040101', stage: 'in_transit' }] as never);
    vi.mocked(repo.markReceived).mockResolvedValue({ id: 'chl-1', status: 'received' } as never);
    vi.mocked(repo.updateLineStage).mockImplementation(async (_tx, id, values) => ({ id, ...values }) as never);

    vi.mocked(entriesRepo.findItemsByEntryIds).mockResolvedValue([] as never);
    const result = await receive(adminCtx, 'chl-1', { missingBatteryCodes: ['26040101'], plantId: MAIN.id });
    expect(result.status).toBe('received');
    expect(result.lines).toEqual([
      expect.objectContaining({ id: 'line-1', stage: 'received', shortage: false }),
      expect.objectContaining({ id: 'line-2', stage: 'in_transit', shortage: true }),
    ]);
  });

  it('refuses a code that is not on the challan', async () => {
    vi.mocked(repo.findChallanById).mockResolvedValue({ id: 'chl-1', no: 'CHL-26-09-0001', status: 'dispatched' } as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue([{ id: 'line-1', batteryCode: '26030777', stage: 'in_transit' }] as never);
    await expect(receive(adminCtx, 'chl-1', { missingBatteryCodes: ['99999999'], plantId: MAIN.id })).rejects.toMatchObject({ code: 'line_not_on_challan' });
  });

  it('cannot be received twice', async () => {
    vi.mocked(repo.findChallanById).mockResolvedValue({ id: 'chl-1', no: 'CHL-26-09-0001', status: 'received' } as never);
    await expect(receive(adminCtx, 'chl-1', { missingBatteryCodes: [], plantId: MAIN.id })).rejects.toMatchObject({ code: 'challan_already_received' });
  });

  it('is head office only', async () => {
    await expect(receive(dealerCtx, 'chl-1', { missingBatteryCodes: [], plantId: MAIN.id })).rejects.toMatchObject({ code: 'permission_denied' });
  });
});

// ---------------------------------------------------------------- plants (memory.md D-19)
const MAIN = { id: '11111111-1111-4111-8111-111111111111', name: 'Main plant', active: true };
const BRANCH1 = { id: '22222222-2222-4222-8222-222222222222', name: 'Branch 1', active: true };
const RETIRED = { id: '33333333-3333-4333-8333-333333333333', name: 'Old plant', active: false };
const plantsById = new Map([MAIN, BRANCH1, RETIRED].map((p) => [p.id, p]));
const challanOnTheWay = { id: 'chl-1', no: 'CHL-26-09-0025', status: 'dispatched' };
const lineOnTheWay = { id: 'line-1', challanId: 'chl-1', entryId: 'entry-1', entryItemId: 'item-1', batteryCode: 'G4002609452', stage: 'in_transit', plantId: null };
const secondLine = { id: 'line-2', challanId: 'chl-1', entryId: 'entry-2', entryItemId: 'item-2', batteryCode: 'GPK8002605436', stage: 'in_transit', plantId: null };

function plantsExist() {
  vi.mocked(mastersRepo.findPlantById).mockImplementation(async (_db, id) => (plantsById.get(id) ?? null) as never);
  vi.mocked(repo.updateLineStage).mockImplementation(async (_tx, id, values) => ({ id, ...values }) as never);
  vi.mocked(repo.markReceived).mockResolvedValue({ id: 'chl-1', status: 'received' } as never);
  vi.mocked(entriesRepo.findItemsByEntryIds).mockResolvedValue([] as never);
}

describe('receiveLine — one battery off the van, tagged with the plant that made it', () => {
  it('arrives with its plant; the plant is copied to the battery; the challan waits for the rest', async () => {
    plantsExist();
    vi.mocked(repo.findLineById).mockResolvedValue(lineOnTheWay as never);
    vi.mocked(repo.findChallanById).mockResolvedValue(challanOnTheWay as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue([{ ...lineOnTheWay, stage: 'received' }, secondLine] as never);

    const r = await receiveLine(adminCtx, 'line-1', { plantId: BRANCH1.id, reason: 'Scanned in at Nashik warehouse' });
    expect(r).toMatchObject({ id: 'line-1', stage: 'received', plantId: BRANCH1.id, shortage: false, challanNo: 'CHL-26-09-0025', stillOnTheWay: 1 });
    expect(batteriesRepo.setBatteryPlant).toHaveBeenCalledWith(expect.anything(), 'G4002609452', BRANCH1.id, now());
    expect(repo.markReceived).not.toHaveBeenCalled(); // GPK8002605436 is still on the way
    expect(vi.mocked(audit).mock.calls[0]?.[1]).toMatchObject({ action: 'return.received', entityRef: 'G4002609452', after: { plant: 'Branch 1', challan: 'CHL-26-09-0025' } });
  });

  it('the last battery to arrive marks the whole challan arrived', async () => {
    plantsExist();
    vi.mocked(repo.findLineById).mockResolvedValue(secondLine as never);
    vi.mocked(repo.findChallanById).mockResolvedValue(challanOnTheWay as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue([{ ...lineOnTheWay, stage: 'received', plantId: BRANCH1.id }, { ...secondLine, stage: 'received' }] as never);
    const r = await receiveLine(adminCtx, 'line-2', { plantId: MAIN.id });
    expect(r.stillOnTheWay).toBe(0);
    expect(repo.markReceived).toHaveBeenCalledWith(expect.anything(), 'chl-1', 'admin-1', now());
  });

  it('two batteries on one challan can be tagged with different plants', async () => {
    plantsExist();
    vi.mocked(repo.findChallanById).mockResolvedValue(challanOnTheWay as never);
    vi.mocked(repo.findLineById).mockResolvedValueOnce(lineOnTheWay as never).mockResolvedValueOnce(secondLine as never);
    vi.mocked(repo.findLinesByChallanId)
      .mockResolvedValueOnce([{ ...lineOnTheWay, stage: 'received' }, secondLine] as never)
      .mockResolvedValueOnce([{ ...lineOnTheWay, stage: 'received' }, { ...secondLine, stage: 'received' }] as never);
    const a = await receiveLine(adminCtx, 'line-1', { plantId: MAIN.id });
    const b = await receiveLine(adminCtx, 'line-2', { plantId: BRANCH1.id });
    expect([a.plantId, b.plantId]).toEqual([MAIN.id, BRANCH1.id]);
  });

  it('moves that battery\'s claim to received, and only that one', async () => {
    plantsExist();
    vi.mocked(repo.findLineById).mockResolvedValue(lineOnTheWay as never);
    vi.mocked(repo.findChallanById).mockResolvedValue(challanOnTheWay as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue([{ ...lineOnTheWay, stage: 'received' }, secondLine] as never);
    vi.mocked(entriesRepo.findItemsByEntryIds).mockResolvedValue([{ id: 'item-1', claimId: 'claim-1' }, { id: 'item-2', claimId: 'claim-2' }] as never);
    vi.mocked(claimsRepo.findClaimById).mockImplementation(async (_db, id) => ({ id, status: 'awaiting_return' }) as never);
    await receiveLine(adminCtx, 'line-1', { plantId: MAIN.id });
    expect(claimsService.receive).toHaveBeenCalledTimes(1);
    expect(claimsService.receive).toHaveBeenCalledWith(adminCtx, 'claim-1');
  });

  it('refuses a battery already confirmed', async () => {
    plantsExist();
    vi.mocked(repo.findLineById).mockResolvedValue({ ...lineOnTheWay, stage: 'received' } as never);
    await expect(receiveLine(adminCtx, 'line-1', { plantId: MAIN.id })).rejects.toMatchObject({ code: 'line_already_received', status: 409 });
    expect(repo.updateLineStage).not.toHaveBeenCalled();
  });

  it('refuses a plant that does not exist, or is switched off', async () => {
    plantsExist();
    vi.mocked(repo.findLineById).mockResolvedValue(lineOnTheWay as never);
    await expect(receiveLine(adminCtx, 'line-1', { plantId: '99999999-9999-4999-8999-999999999999' })).rejects.toMatchObject({ code: 'plant_not_found', status: 422 });
    await expect(receiveLine(adminCtx, 'line-1', { plantId: RETIRED.id })).rejects.toMatchObject({ code: 'plant_inactive', message: expect.stringContaining('Old plant is switched off') });
    expect(repo.updateLineStage).not.toHaveBeenCalled();
  });

  it('the plant is required — the form cannot be sent without it', () => {
    const r = LineReceiveBody.safeParse({ reason: 'Scanned in at Nashik warehouse' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('Choose the plant that made this battery.');
  });

  it('is head office only', async () => {
    await expect(receiveLine(dealerCtx, 'line-1', { plantId: MAIN.id })).rejects.toMatchObject({ code: 'permission_denied' });
  });
});

describe('receive (whole van) — with plants', () => {
  it('"Confirm all arrived" with one plant tags every battery arriving now', async () => {
    plantsExist();
    vi.mocked(repo.findChallanById).mockResolvedValue(challanOnTheWay as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue([lineOnTheWay, secondLine] as never);
    const r = await receive(adminCtx, 'chl-1', { missingBatteryCodes: [], plantId: MAIN.id });
    expect(r.lines).toEqual([expect.objectContaining({ id: 'line-1', plantId: MAIN.id }), expect.objectContaining({ id: 'line-2', plantId: MAIN.id })]);
    expect(batteriesRepo.setBatteryPlant).toHaveBeenCalledTimes(2);
  });

  it('a battery missing from the van gets no plant', async () => {
    plantsExist();
    vi.mocked(repo.findChallanById).mockResolvedValue(challanOnTheWay as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue([lineOnTheWay, secondLine] as never);
    const r = await receive(adminCtx, 'chl-1', { missingBatteryCodes: ['GPK8002605436'], plantId: MAIN.id });
    expect(r.lines[1]).toMatchObject({ id: 'line-2', stage: 'in_transit', shortage: true });
    expect(r.lines[1]).not.toHaveProperty('plantId');
    expect(batteriesRepo.setBatteryPlant).toHaveBeenCalledTimes(1);
  });

  it('leaves a battery already confirmed on its own untouched — its stage and its plant', async () => {
    plantsExist();
    const alreadyTested = { ...lineOnTheWay, stage: 'testing', plantId: BRANCH1.id };
    vi.mocked(repo.findChallanById).mockResolvedValue(challanOnTheWay as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue([alreadyTested, secondLine] as never);
    const r = await receive(adminCtx, 'chl-1', { missingBatteryCodes: [], plantId: MAIN.id });
    expect(r.lines[0]).toEqual(alreadyTested); // before: this was reset to "received"
    expect(repo.updateLineStage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repo.updateLineStage).mock.calls[0]?.[1]).toBe('line-2');
  });

  it('refuses to call a battery missing when it was already confirmed', async () => {
    plantsExist();
    vi.mocked(repo.findChallanById).mockResolvedValue(challanOnTheWay as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue([{ ...lineOnTheWay, stage: 'received' }, secondLine] as never);
    await expect(receive(adminCtx, 'chl-1', { missingBatteryCodes: ['G4002609452'], plantId: MAIN.id })).rejects.toMatchObject({ code: 'line_already_received' });
  });

  it('the plant is required for the whole van too, now the admin app sends it', () => {
    const r = ChallanReceiveBody.safeParse({ missingBatteryCodes: [], reason: 'Scanned in at Nashik warehouse' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('Choose the plant that made this battery.');
  });

  it('refuses a switched-off plant before touching anything', async () => {
    plantsExist();
    vi.mocked(repo.findChallanById).mockResolvedValue(challanOnTheWay as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue([lineOnTheWay] as never);
    await expect(receive(adminCtx, 'chl-1', { missingBatteryCodes: [], plantId: RETIRED.id })).rejects.toMatchObject({ code: 'plant_inactive' });
    expect(repo.markReceived).not.toHaveBeenCalled();
  });
});

describe('setLinePlant — correcting a misread label', () => {
  it('re-tags an arrived battery, on the battery too, and records both names', async () => {
    plantsExist();
    vi.mocked(repo.findLineById).mockResolvedValue({ ...lineOnTheWay, stage: 'received', plantId: MAIN.id } as never);
    vi.mocked(repo.setLinePlant).mockImplementation(async (_tx, id, plantId) => ({ id, plantId }) as never);
    const r = await setLinePlant(adminCtx, 'line-1', { plantId: BRANCH1.id, reason: 'Misread the label — it is a Branch 1 serial' });
    expect(r).toMatchObject({ plantId: BRANCH1.id });
    expect(batteriesRepo.setBatteryPlant).toHaveBeenCalledWith(expect.anything(), 'G4002609452', BRANCH1.id, now());
    expect(vi.mocked(audit).mock.calls[0]?.[1]).toMatchObject({
      action: 'return.plant_changed', before: { plant: 'Main plant' }, after: { plant: 'Branch 1' }, reason: 'Misread the label — it is a Branch 1 serial',
    });
  });

  it('tags a battery that arrived before plants existed', async () => {
    plantsExist();
    vi.mocked(repo.findLineById).mockResolvedValue({ ...lineOnTheWay, stage: 'testing', plantId: null } as never);
    vi.mocked(repo.setLinePlant).mockImplementation(async (_tx, id, plantId) => ({ id, plantId }) as never);
    await setLinePlant(adminCtx, 'line-1', { plantId: MAIN.id, reason: 'Arrived before plants were tracked' });
    expect(vi.mocked(audit).mock.calls[0]?.[1]).toMatchObject({ before: { plantId: null, plant: null }, after: { plant: 'Main plant' } });
  });

  it('a battery still on the way gets its plant when it arrives, not here', async () => {
    plantsExist();
    vi.mocked(repo.findLineById).mockResolvedValue(lineOnTheWay as never);
    await expect(setLinePlant(adminCtx, 'line-1', { plantId: MAIN.id, reason: 'Tagging early' })).rejects.toMatchObject({ code: 'line_not_arrived', status: 409 });
  });

  it('refuses a change to the plant it already has', async () => {
    plantsExist();
    vi.mocked(repo.findLineById).mockResolvedValue({ ...lineOnTheWay, stage: 'received', plantId: MAIN.id } as never);
    await expect(setLinePlant(adminCtx, 'line-1', { plantId: MAIN.id, reason: 'Same again' })).rejects.toMatchObject({ code: 'plant_unchanged' });
    expect(repo.setLinePlant).not.toHaveBeenCalled();
  });
});

describe('stage — processing after arrival follows the chain', () => {
  it('received -> testing -> scrapped -> closed', async () => {
    vi.mocked(repo.updateLineStage).mockImplementation(async (_tx, id, values) => ({ id, ...values }) as never);
    vi.mocked(repo.findLineById).mockResolvedValueOnce({ id: 'line-1', stage: 'received', batteryCode: '26030777' } as never);
    expect((await stage(adminCtx, 'line-1', { stage: 'testing', reason: 'Bench test started' }))?.stage).toBe('testing');
    vi.mocked(repo.findLineById).mockResolvedValueOnce({ id: 'line-1', stage: 'testing', batteryCode: '26030777' } as never);
    expect((await stage(adminCtx, 'line-1', { stage: 'scrapped', reason: 'Cell dead, not repairable' }))?.stage).toBe('scrapped');
    vi.mocked(repo.findLineById).mockResolvedValueOnce({ id: 'line-1', stage: 'scrapped', batteryCode: '26030777' } as never);
    expect((await stage(adminCtx, 'line-1', { stage: 'closed', reason: 'Disposed with scrap lot 12' }))?.stage).toBe('closed');
  });

  it('refuses a skipped step', async () => {
    vi.mocked(repo.findLineById).mockResolvedValue({ id: 'line-1', stage: 'in_transit', batteryCode: '26030777' } as never);
    await expect(stage(adminCtx, 'line-1', { stage: 'closed', reason: 'Skipping ahead' })).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});

describe('the Claim button — one challan, every battery that passed', () => {
  // 4 batteries went back: two passed their check, one was refused, one is still on the van
  const lines = [
    { id: 'l1', challanId: 'ch-1', entryItemId: 'it-1', batteryCode: 'M526030001' },
    { id: 'l2', challanId: 'ch-1', entryItemId: 'it-2', batteryCode: 'M526030002' },
    { id: 'l3', challanId: 'ch-1', entryItemId: 'it-3', batteryCode: 'M526030003' },
    { id: 'l4', challanId: 'ch-1', entryItemId: 'it-4', batteryCode: 'M526030004' },
  ];
  const states = [
    { entryItemId: 'it-1', claimId: 'cl-1', status: 'checked', decisionReason: null, conditionNote: 'Cells gone' },
    { entryItemId: 'it-2', claimId: 'cl-2', status: 'checked', decisionReason: null, conditionNote: null },
    { entryItemId: 'it-3', claimId: 'cl-3', status: 'refused', decisionReason: 'Physical damage', conditionNote: null },
    { entryItemId: 'it-4', claimId: 'cl-4', status: 'awaiting_return', decisionReason: null, conditionNote: null },
  ];
  beforeEach(() => {
    vi.mocked(repo.findChallanById).mockResolvedValue({ id: 'ch-1', no: 'CHL-26-09-0039', dealerId: 'dealer-1' } as never);
    vi.mocked(repo.findLinesByChallanId).mockResolvedValue(lines as never);
    vi.mocked(repo.findClaimStateByEntryItemIds).mockResolvedValue(states as never);
    vi.mocked(claimsService.decide).mockImplementation((async (_ctx: unknown, id: string) =>
      ({ claim: { id }, creditNote: { no: `CN-${id}` } })) as never);
  });

  it('approves for refund only the batteries that passed their check', async () => {
    const r = await claimChecked(adminCtx, 'ch-1', { reason: 'Checked at the factory — all good' });
    expect(r.claimed).toBe(2);
    expect(r.skipped).toBe(2); // the refused one and the one still travelling
    expect(r.creditNotes.map(c => c.no)).toEqual(['CN-cl-1', 'CN-cl-2']);
    // the refused battery and the one still on the van are never touched
    const decided = vi.mocked(claimsService.decide).mock.calls.map(c => c[1]);
    expect(decided).toEqual(['cl-1', 'cl-2']);
  });

  it('clicking it a second time pays nobody twice', async () => {
    // after the first click those two are 'approved', so nothing is left at 'checked'
    vi.mocked(repo.findClaimStateByEntryItemIds).mockResolvedValue(
      states.map(s => (s.status === 'checked' ? { ...s, status: 'approved' } : s)) as never);
    await expect(claimChecked(adminCtx, 'ch-1', { reason: 'Second click by mistake' }))
      .rejects.toMatchObject({ code: 'nothing_to_claim' });
    expect(claimsService.decide).not.toHaveBeenCalled();
  });

  it('a dealer cannot approve their own batteries for refund', async () => {
    await expect(claimChecked(dealerCtx, 'ch-1', { reason: 'Please pay me' })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(claimsService.decide).not.toHaveBeenCalled();
  });

  it('groups every battery on the challan by what happened to it, for both sides to read', async () => {
    const r = await getById(adminCtx, 'ch-1');
    expect(r.lines.map(l => l.outcome)).toEqual(['passed', 'passed', 'rejected', 'travelling']);
    // the refusal reason travels with the line, so the dealer is told why
    expect(r.lines[2]!.outcomeReason).toBe('Physical damage');
  });
});

describe('every challan read carries each battery outcome', () => {
  it('the LIST carries them too — the console builds its whole store from it', async () => {
    // without this the groups were always empty: no outcome means "still travelling"
    vi.mocked(repo.listChallans).mockResolvedValue({ items: [{ id: 'ch-1', no: 'CHL-26-10-0005', dealerId: 'dealer-1' }], nextCursor: null } as never);
    vi.mocked(repo.findLinesByChallanIds).mockResolvedValue([
      { id: 'l1', challanId: 'ch-1', entryItemId: 'it-1', batteryCode: 'K800260923154' },
      { id: 'l2', challanId: 'ch-1', entryItemId: 'it-2', batteryCode: 'K80026091280' },
    ] as never);
    vi.mocked(repo.findClaimStateByEntryItemIds).mockResolvedValue([
      { entryItemId: 'it-1', claimId: 'cl-1', status: 'checked', decisionReason: null, conditionNote: null },
      { entryItemId: 'it-2', claimId: 'cl-2', status: 'raised', decisionReason: null, conditionNote: null },
    ] as never);
    const r = await list(adminCtx, { limit: 50 } as never);
    expect(r.items[0]!.lines.map(l => l.outcome)).toEqual(['passed', 'travelling']);
  });
});
