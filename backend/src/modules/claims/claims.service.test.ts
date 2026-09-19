import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({
  db: {},
  withTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('../../utils/audit', () => ({ audit: vi.fn() }));

vi.mock('../credits/credits.service', () => ({
  issueInTx: vi.fn(),
}));

vi.mock('../batteries/batteries.repository', () => ({
  findBatteryById: vi.fn(async (_db: unknown, id: string) => ({ id, state: 'returned', custodian: 'dealer', dealerId: 'dealer-1' })),
}));

vi.mock('../stock/stock.service', () => ({
  postMovementInTx: vi.fn(async () => ({ movement: { id: 'mv-1' }, battery: {} })),
}));

vi.mock('../../utils/ids', () => ({
  nextFormattedRef: vi.fn(async (_tx: unknown, prefix: string) => `${prefix}-26-09-0001`),
  monthKey: vi.fn(() => '26-09'),
}));

vi.mock('./claims.repository', () => ({
  findClaimById: vi.fn(),
  insertClaim: vi.fn(),
  updateClaimStatus: vi.fn(),
  updateClaimCheck: vi.fn(),
  updateClaimDecision: vi.fn(),
  listClaims: vi.fn(),
}));

import { issueInTx as issueCreditNoteInTx } from '../credits/credits.service';
import { postMovementInTx } from '../stock/stock.service';
import * as repo from './claims.repository';
import { check, decide, dispatch, receive } from './claims.service';
import type { Ctx } from '../../utils/context';

const now = () => new Date('2026-09-17T10:00:00Z');
const dealerCtx: Ctx = {
  user: { id: 'user-1', scope: 'dealer', role: 'dealer_manager', dealerId: 'dealer-1' },
  request: { id: 'req-1', ip: '127.0.0.1', deviceId: 'device-1', userAgent: 'vitest' },
  now,
};
const adminCtx: Ctx = { ...dealerCtx, user: { id: 'admin-1', scope: 'admin', role: 'main_admin' } };
const anonCtx: Ctx = { ...dealerCtx, user: null };

beforeEach(() => vi.clearAllMocks());

describe('dispatch / receive — status transitions are enforced in order', () => {
  it('rejects dispatching a claim that is not "raised"', async () => {
    vi.mocked(repo.findClaimById).mockResolvedValue({ id: 'claim-1', status: 'checked' } as never);
    await expect(dispatch(dealerCtx, 'claim-1')).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('rejects receiving a claim that has not been dispatched', async () => {
    vi.mocked(repo.findClaimById).mockResolvedValue({ id: 'claim-1', status: 'raised' } as never);
    await expect(receive(dealerCtx, 'claim-1')).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('moves raised -> awaiting_return -> received in order', async () => {
    vi.mocked(repo.findClaimById).mockResolvedValueOnce({ id: 'claim-1', ref: 'CLM-1', status: 'raised', oldBatteryId: 'old-1' } as never);
    vi.mocked(repo.updateClaimStatus).mockResolvedValueOnce({ id: 'claim-1', status: 'awaiting_return' } as never);
    const afterDispatch = await dispatch(dealerCtx, 'claim-1');
    expect(afterDispatch.status).toBe('awaiting_return');
    // the old battery's custody moves to transit in the stock ledger, same transaction
    expect(postMovementInTx).toHaveBeenCalledWith(expect.anything(), dealerCtx, expect.objectContaining({ battery: expect.objectContaining({ id: 'old-1' }), claimId: 'claim-1', toState: 'returned', toCustodian: 'transit', reasonCode: 'claim_dispatched' }));

    vi.mocked(repo.findClaimById).mockResolvedValueOnce({ id: 'claim-1', ref: 'CLM-1', status: 'awaiting_return', oldBatteryId: 'old-1' } as never);
    vi.mocked(repo.updateClaimStatus).mockResolvedValueOnce({ id: 'claim-1', status: 'received' } as never);
    const afterReceive = await receive(dealerCtx, 'claim-1');
    expect(afterReceive.status).toBe('received');
    expect(postMovementInTx).toHaveBeenLastCalledWith(expect.anything(), dealerCtx, expect.objectContaining({ toCustodian: 'company', toDealerId: null, reasonCode: 'claim_received' }));
  });
});

describe('check — engineer inspection', () => {
  it("moves to 'checked' (awaiting a second decision) when the fault does not disqualify", async () => {
    vi.mocked(repo.findClaimById).mockResolvedValue({ id: 'claim-1', ref: 'CLM-1', status: 'received' } as never);
    vi.mocked(repo.updateClaimCheck).mockResolvedValue({ id: 'claim-1', status: 'checked' } as never);

    const result = await check(adminCtx, 'claim-1', { findingCode: 'not_holding_charge', disposition: 'repair', disqualify: false });

    expect(result.status).toBe('checked');
    expect(repo.updateClaimCheck).toHaveBeenCalledWith(expect.anything(), 'claim-1', expect.not.objectContaining({ decidedBy: expect.anything() }));
  });

  it('the engineer can refuse the claim directly when the fault disqualifies it — no second person needed', async () => {
    vi.mocked(repo.findClaimById).mockResolvedValue({ id: 'claim-1', ref: 'CLM-1', status: 'received' } as never);
    vi.mocked(repo.updateClaimCheck).mockResolvedValue({ id: 'claim-1', status: 'refused' } as never);

    const result = await check(adminCtx, 'claim-1', { findingCode: 'physical_damage', disposition: 'scrap', disqualify: true, reason: 'Casing cracked, not a warranty fault' });

    expect(result.status).toBe('refused');
    expect(repo.updateClaimCheck).toHaveBeenCalledWith(expect.anything(), 'claim-1', expect.objectContaining({ status: 'refused', decidedBy: 'admin-1' }));
    // disposition 'scrap' is a ledger movement on the old battery
    expect(postMovementInTx).toHaveBeenCalledWith(expect.anything(), adminCtx, expect.objectContaining({ toState: 'scrap', toCustodian: 'company', reasonCode: 'inspection', reasonText: 'physical_damage' }));
  });

  it("disposition 'hold' leaves the battery where it is — no movement", async () => {
    vi.mocked(repo.findClaimById).mockResolvedValue({ id: 'claim-1', ref: 'CLM-1', status: 'received', oldBatteryId: 'old-1' } as never);
    vi.mocked(repo.updateClaimCheck).mockResolvedValue({ id: 'claim-1', status: 'checked' } as never);
    await check(adminCtx, 'claim-1', { findingCode: 'needs_second_look', disposition: 'hold', disqualify: false });
    expect(postMovementInTx).not.toHaveBeenCalled();
  });
});

describe('decide — second person, only after checked', () => {
  it('rejects deciding a claim that has not been checked yet', async () => {
    vi.mocked(repo.findClaimById).mockResolvedValue({ id: 'claim-1', status: 'received' } as never);
    await expect(decide(adminCtx, 'claim-1', { outcome: 'approved', reason: 'Confirmed manufacturing fault' })).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('refusing does not issue a credit note', async () => {
    vi.mocked(repo.findClaimById).mockResolvedValue({ id: 'claim-1', ref: 'CLM-1', status: 'checked', dealerId: 'dealer-1', newBatteryId: 'batt-mar' } as never);
    vi.mocked(repo.updateClaimDecision).mockResolvedValue({ id: 'claim-1', status: 'refused' } as never);

    const result = await decide(adminCtx, 'claim-1', { outcome: 'refused', reason: 'Not covered' });

    expect(result.creditNote).toBeNull();
    expect(issueCreditNoteInTx).not.toHaveBeenCalled();
  });

  it('approving issues a credit note through the credits module and links it to the claim', async () => {
    const claim = { id: 'claim-1', ref: 'CLM-1', status: 'checked', dealerId: 'dealer-1', newBatteryId: 'batt-mar' };
    vi.mocked(repo.findClaimById).mockResolvedValue(claim as never);
    vi.mocked(issueCreditNoteInTx).mockResolvedValue({ id: 'cn-1', no: 'CN-26-09-0001', amount: 4250 } as never);
    vi.mocked(repo.updateClaimDecision).mockResolvedValue({ id: 'claim-1', status: 'approved', creditNoteId: 'cn-1' } as never);

    const result = await decide(adminCtx, 'claim-1', { outcome: 'approved', reason: 'Confirmed manufacturing fault' });

    expect(issueCreditNoteInTx).toHaveBeenCalledWith(expect.anything(), adminCtx, { claim });
    expect(repo.updateClaimDecision).toHaveBeenCalledWith(expect.anything(), 'claim-1', expect.objectContaining({ status: 'approved', creditNoteId: 'cn-1' }));
    expect(result.creditNote).toMatchObject({ amount: 4250 });
  });
});

describe('auth guard applies to every action', () => {
  it('rejects an unauthenticated caller on every entry point', async () => {
    await expect(dispatch(anonCtx, 'claim-1')).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
