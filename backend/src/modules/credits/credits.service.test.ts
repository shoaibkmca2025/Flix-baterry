import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({
  db: {},
  withTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('../../utils/audit', () => ({ audit: vi.fn() }));

vi.mock('../batteries/batteries.repository', () => ({
  findBatteryById: vi.fn(),
}));

vi.mock('../claims/claims.repository', () => ({
  countClaimsByStatus: vi.fn(),
}));

vi.mock('../../utils/ids', () => ({
  nextFormattedRef: vi.fn(async (_tx: unknown, prefix: string) => `${prefix}-26-09-0001`),
  monthKey: vi.fn(() => '26-09'),
}));

vi.mock('./credits.repository', () => ({
  findCreditNoteById: vi.fn(),
  findCreditNoteByNo: vi.fn(),
  insertCreditNote: vi.fn(),
  updateCreditNoteSettled: vi.fn(),
  updateCreditNoteReversed: vi.fn(),
  listCreditNotes: vi.fn(),
  sumCreditedForDealer: vi.fn(),
}));

import { audit } from '../../utils/audit';
import { findBatteryById } from '../batteries/batteries.repository';
import { countClaimsByStatus } from '../claims/claims.repository';
import * as repo from './credits.repository';
import { getByNo, issueInTx, list, reverse, settle, startOfBusinessMonth, summary } from './credits.service';
import type { Ctx } from '../../utils/context';

const now = () => new Date('2026-09-17T10:00:00Z');
const dealerCtx: Ctx = {
  user: { id: 'user-1', scope: 'dealer', role: 'dealer_manager', dealerId: 'dealer-1' },
  request: { id: 'req-1', ip: '127.0.0.1', deviceId: 'device-1', userAgent: 'vitest' },
  now,
};
const adminCtx: Ctx = { ...dealerCtx, user: { id: 'admin-1', scope: 'admin', role: 'main_admin' } };
const anonCtx: Ctx = { ...dealerCtx, user: null };

const claim = { id: 'claim-1', ref: 'CLM-26-09-0001', dealerId: 'dealer-1', newBatteryId: 'batt-new' };

beforeEach(() => vi.clearAllMocks());

describe('issueInTx — called by claims.decide', () => {
  it('prices the note from the new battery model (demo D-08 rates) and numbers it CN-YY-MM-NNNN', async () => {
    vi.mocked(findBatteryById).mockResolvedValue({ id: 'batt-new', modelId: 'M5' } as never);
    vi.mocked(repo.insertCreditNote).mockImplementation(async (_tx, input) => ({ id: 'cn-1', status: 'issued', ...input }) as never);

    const note = await issueInTx({} as never, adminCtx, { claim });

    expect(note).toMatchObject({ no: 'CN-26-09-0001', dealerId: 'dealer-1', claimId: 'claim-1', amount: 4250, issuedBy: 'admin-1' });
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'credit_note.issued', entityRef: 'CN-26-09-0001' }));
  });

  it('falls back to the default rate for a model with no demo rate', async () => {
    vi.mocked(findBatteryById).mockResolvedValue({ id: 'batt-new', modelId: 'ZZ9' } as never);
    vi.mocked(repo.insertCreditNote).mockImplementation(async (_tx, input) => ({ id: 'cn-1', ...input }) as never);

    const note = await issueInTx({} as never, adminCtx, { claim });
    expect(note.amount).toBe(3000);
  });

  it('refuses to issue without a signed-in actor', async () => {
    await expect(issueInTx({} as never, anonCtx, { claim })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(repo.insertCreditNote).not.toHaveBeenCalled();
  });
});

describe('list / getByNo — dealers only ever see their own notes', () => {
  it('forces the dealer scope on list even when a dealerId filter is passed', async () => {
    vi.mocked(repo.listCreditNotes).mockResolvedValue({ items: [], nextCursor: null });
    await list(dealerCtx, { dealerId: 'someone-else', limit: 50 });
    expect(repo.listCreditNotes).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: 'dealer-1' }));
  });

  it('lets an admin filter by any dealer, or none', async () => {
    vi.mocked(repo.listCreditNotes).mockResolvedValue({ items: [], nextCursor: null });
    await list(adminCtx, { limit: 50 });
    expect(repo.listCreditNotes).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dealerId: undefined }));
  });

  it('rejects a malformed cursor with filter_invalid', async () => {
    await expect(list(adminCtx, { limit: 50, cursor: '!!!' })).rejects.toMatchObject({ code: 'filter_invalid' });
  });

  it("returns 404 (not 403) for another dealer's note — no existence leak", async () => {
    vi.mocked(repo.findCreditNoteByNo).mockResolvedValue({ id: 'cn-1', no: 'CN-26-09-0001', dealerId: 'dealer-2' } as never);
    await expect(getByNo(dealerCtx, 'CN-26-09-0001')).rejects.toMatchObject({ code: 'credit_note_not_found' });
  });

  it('looks up by number (case-insensitive) or by uuid', async () => {
    vi.mocked(repo.findCreditNoteByNo).mockResolvedValue({ id: 'cn-1', no: 'CN-26-09-0001', dealerId: 'dealer-1' } as never);
    vi.mocked(repo.findCreditNoteById).mockResolvedValue({ id: 'cn-1', no: 'CN-26-09-0001', dealerId: 'dealer-1' } as never);

    await expect(getByNo(dealerCtx, 'cn-26-09-0001')).resolves.toMatchObject({ id: 'cn-1' });
    expect(repo.findCreditNoteByNo).toHaveBeenCalledWith(expect.anything(), 'CN-26-09-0001');

    await expect(getByNo(dealerCtx, '0b6d1e1e-7d1a-4b6c-9f8e-2f4a1c3d5e6f')).resolves.toMatchObject({ id: 'cn-1' });
    expect(repo.findCreditNoteById).toHaveBeenCalledWith(expect.anything(), '0b6d1e1e-7d1a-4b6c-9f8e-2f4a1c3d5e6f');
  });
});

describe('summary — the d37 KPIs', () => {
  it('combines month total, all-time total and claim counts for the dealer', async () => {
    vi.mocked(repo.sumCreditedForDealer).mockResolvedValueOnce({ total: 8500, count: 2 }).mockResolvedValueOnce({ total: 12300, count: 3 });
    vi.mocked(countClaimsByStatus).mockResolvedValue({ raised: 1, checked: 2, approved: 3, refused: 1 });

    const result = await summary(dealerCtx, {});

    expect(result).toEqual({ dealerId: 'dealer-1', monthTotal: 8500, totalCredited: 12300, creditedCount: 3, checkingCount: 3, refusedCount: 1 });
    // the month window starts at the Kolkata month boundary, not UTC's
    expect(vi.mocked(repo.sumCreditedForDealer).mock.calls[0]![2]).toEqual(new Date('2026-08-31T18:30:00Z'));
  });

  it('requires an admin to name the dealer', async () => {
    await expect(summary(adminCtx, {})).rejects.toMatchObject({ code: 'dealer_required' });
  });
});

describe('startOfBusinessMonth', () => {
  it('uses the Asia/Kolkata calendar: 1 Oct 00:15 IST is already October', () => {
    // 30 Sep 18:45 UTC == 1 Oct 00:15 IST
    expect(startOfBusinessMonth(new Date('2026-09-30T18:45:00Z'))).toEqual(new Date('2026-09-30T18:30:00Z'));
    // 30 Sep 18:15 UTC == 30 Sep 23:45 IST — still September
    expect(startOfBusinessMonth(new Date('2026-09-30T18:15:00Z'))).toEqual(new Date('2026-08-31T18:30:00Z'));
  });
});

describe('settle / reverse — only an issued note can change', () => {
  it('settles an issued note with the invoice reference and audits it', async () => {
    vi.mocked(repo.findCreditNoteByNo).mockResolvedValue({ id: 'cn-1', no: 'CN-26-09-0001', status: 'issued', amount: 4250 } as never);
    vi.mocked(repo.updateCreditNoteSettled).mockResolvedValue({ id: 'cn-1', status: 'settled', settledRef: 'INV-1001' } as never);

    const result = await settle(adminCtx, 'CN-26-09-0001', { ref: 'INV-1001' });

    expect(result.status).toBe('settled');
    expect(repo.updateCreditNoteSettled).toHaveBeenCalledWith(expect.anything(), 'cn-1', expect.objectContaining({ settledRef: 'INV-1001', adjustedBy: 'admin-1' }));
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'credit_note.settled' }));
  });

  it('rejects settling twice with already_settled', async () => {
    vi.mocked(repo.findCreditNoteByNo).mockResolvedValue({ id: 'cn-1', no: 'CN-26-09-0001', status: 'settled', settledRef: 'INV-1001' } as never);
    await expect(settle(adminCtx, 'CN-26-09-0001', { ref: 'INV-1002' })).rejects.toMatchObject({ code: 'already_settled' });
    expect(repo.updateCreditNoteSettled).not.toHaveBeenCalled();
  });

  it('cannot reverse a note that is already on an invoice', async () => {
    vi.mocked(repo.findCreditNoteByNo).mockResolvedValue({ id: 'cn-1', no: 'CN-26-09-0001', status: 'settled', settledRef: 'INV-1001' } as never);
    await expect(reverse(adminCtx, 'CN-26-09-0001', { reason: 'Issued in error' })).rejects.toMatchObject({ code: 'already_settled' });
  });

  it('reverses an issued note with a reason, and a reversed note is then frozen', async () => {
    vi.mocked(repo.findCreditNoteByNo).mockResolvedValueOnce({ id: 'cn-1', no: 'CN-26-09-0001', status: 'issued', amount: 4250 } as never);
    vi.mocked(repo.updateCreditNoteReversed).mockResolvedValue({ id: 'cn-1', status: 'reversed' } as never);

    const result = await reverse(adminCtx, 'CN-26-09-0001', { reason: 'Issued in error' });
    expect(result.status).toBe('reversed');
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'credit_note.reversed', reason: 'Issued in error' }));

    vi.mocked(repo.findCreditNoteByNo).mockResolvedValueOnce({ id: 'cn-1', no: 'CN-26-09-0001', status: 'reversed' } as never);
    await expect(settle(adminCtx, 'CN-26-09-0001', { ref: 'INV-1001' })).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('404s on an unknown note', async () => {
    vi.mocked(repo.findCreditNoteByNo).mockResolvedValue(undefined as never);
    await expect(settle(adminCtx, 'CN-99-99-9999', { ref: 'INV-1' })).rejects.toMatchObject({ code: 'credit_note_not_found' });
  });
});

describe('auth guard applies to every action', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(list(anonCtx, { limit: 50 })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(settle(anonCtx, 'CN-26-09-0001', { ref: 'INV-1' })).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
