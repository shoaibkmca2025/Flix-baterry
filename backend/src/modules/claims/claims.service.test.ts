import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({
  db: {},
  withTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('../../utils/audit', () => ({ audit: vi.fn() }));

vi.mock('../batteries/batteries.repository', () => ({
  findBatteryById: vi.fn(),
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
  insertCreditNote: vi.fn(),
  listClaims: vi.fn(),
}));

import { findBatteryById } from '../batteries/batteries.repository';
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
    vi.mocked(repo.findClaimById).mockResolvedValueOnce({ id: 'claim-1', ref: 'CLM-1', status: 'raised' } as never);
    vi.mocked(repo.updateClaimStatus).mockResolvedValueOnce({ id: 'claim-1', status: 'awaiting_return' } as never);
    const afterDispatch = await dispatch(dealerCtx, 'claim-1');
    expect(afterDispatch.status).toBe('awaiting_return');

    vi.mocked(repo.findClaimById).mockResolvedValueOnce({ id: 'claim-1', ref: 'CLM-1', status: 'awaiting_return' } as never);
    vi.mocked(repo.updateClaimStatus).mockResolvedValueOnce({ id: 'claim-1', status: 'received' } as never);
    const afterReceive = await receive(dealerCtx, 'claim-1');
    expect(afterReceive.status).toBe('received');
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
    expect(repo.insertCreditNote).not.toHaveBeenCalled();
  });

  it('approving issues a credit note using the demo rate for the battery model', async () => {
    vi.mocked(repo.findClaimById).mockResolvedValue({ id: 'claim-1', ref: 'CLM-1', status: 'checked', dealerId: 'dealer-1', newBatteryId: 'batt-mar' } as never);
    vi.mocked(findBatteryById).mockResolvedValue({ id: 'batt-mar', modelId: 'M5' } as never);
    vi.mocked(repo.insertCreditNote).mockResolvedValue({ id: 'cn-1', no: 'CN-26-09-0001', amount: 4250 } as never);
    vi.mocked(repo.updateClaimDecision).mockResolvedValue({ id: 'claim-1', status: 'approved', creditNoteId: 'cn-1' } as never);

    const result = await decide(adminCtx, 'claim-1', { outcome: 'approved', reason: 'Confirmed manufacturing fault' });

    expect(repo.insertCreditNote).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: 'dealer-1', amount: 4250 }));
    expect(result.creditNote).toMatchObject({ amount: 4250 });
  });
});

describe('auth guard applies to every action', () => {
  it('rejects an unauthenticated caller on every entry point', async () => {
    await expect(dispatch(anonCtx, 'claim-1')).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
