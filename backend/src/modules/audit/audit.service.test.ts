import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/client', () => ({ db: {} }));

vi.mock('../entries/entries.repository', () => ({
  findEntryById: vi.fn(),
}));

vi.mock('./audit.repository', () => ({
  listAuditEvents: vi.fn(),
  listAuditEventsForEntity: vi.fn(),
  findActorNames: vi.fn(async () => new Map([['admin-1', 'Asha (HO)'], ['user-1', 'Ravi']])),
}));

import { findEntryById } from '../entries/entries.repository';
import * as repo from './audit.repository';
import { entryTrail, list, redactSnapshot, trail } from './audit.service';
import type { Ctx } from '../../utils/context';

const now = () => new Date('2026-09-19T10:00:00Z');
const base = { request: { id: 'req-1', ip: '127.0.0.1', deviceId: 'device-1', userAgent: 'vitest' }, now };
const mainAdmin: Ctx = { ...base, user: { id: 'admin-1', scope: 'admin', role: 'main_admin' } };
const coAdmin: Ctx = { ...base, user: { id: 'admin-2', scope: 'admin', role: 'co_admin' } };
const readOnly: Ctx = { ...base, user: { id: 'admin-3', scope: 'admin', role: 'read_only' } };
const dealerCtx: Ctx = { ...base, user: { id: 'user-1', scope: 'dealer', role: 'dealer_manager', dealerId: 'dealer-1' } };
const anonCtx: Ctx = { ...base, user: null };

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1, at: new Date('2026-09-18T05:00:00Z'), actorId: 'admin-1', actorRole: 'main_admin', actorScope: 'admin', actorDealerId: null,
  action: 'dealer.approved', entityType: 'dealer', entityId: 'dealer-1', entityRef: 'FPP-014',
  before: { status: 'pending_approval', mobile: '9876543210', email: 'shop@example.com', customerName: 'Meera' },
  after: { status: 'active' }, reason: 'Documents ok', outcome: 'ok', requestId: 'r-1', ip: '10.0.0.1', deviceId: 'd-1', userAgent: 'x',
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('redactSnapshot', () => {
  const snap = { mobile: '9876543210', email: 'shop@example.com', customerName: 'Meera', nested: { contactMobile: '9000000001' }, status: 'active' };
  it('main_admin sees everything', () => {
    expect(redactSnapshot(snap, 'none')).toEqual(snap);
  });
  it('other admins get contacts masked, recursively, but keep names', () => {
    expect(redactSnapshot(snap, 'contacts')).toEqual({ mobile: '98xxxxxx10', email: 's…@example.com', customerName: 'Meera', nested: { contactMobile: '90xxxxxx01' }, status: 'active' });
  });
  it('read_only also loses customer names', () => {
    expect(redactSnapshot(snap, 'contacts_and_names')).toMatchObject({ customerName: '[redacted]', mobile: '98xxxxxx10' });
  });
  it('passes through primitives, null and arrays', () => {
    expect(redactSnapshot(null, 'contacts')).toBeNull();
    expect(redactSnapshot('9876543210', 'contacts')).toBe('9876543210'); // a bare string has no key to judge by
    expect(redactSnapshot([{ mobile: '9876543210' }], 'contacts')).toEqual([{ mobile: '98xxxxxx10' }]);
  });
});

describe('list — admin audit log', () => {
  it('rejects anonymous and dealer callers', async () => {
    await expect(list(anonCtx, { limit: 50 })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(list(dealerCtx, { limit: 50 })).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('translates business-date filters to Asia/Kolkata day boundaries (to is inclusive)', async () => {
    vi.mocked(repo.listAuditEvents).mockResolvedValue({ items: [], nextCursor: null });
    await list(mainAdmin, { limit: 50, from: '2026-09-01', to: '2026-09-18' });
    expect(repo.listAuditEvents).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      from: new Date('2026-08-31T18:30:00Z'),
      to: new Date('2026-09-18T18:30:00Z'), // start of the 19th IST — exclusive
    }));
  });

  it('refuses an inverted date range and a malformed cursor', async () => {
    await expect(list(mainAdmin, { limit: 50, from: '2026-09-18', to: '2026-09-01' })).rejects.toMatchObject({ code: 'filter_invalid' });
    await expect(list(mainAdmin, { limit: 50, cursor: '!!' })).rejects.toMatchObject({ code: 'filter_invalid' });
  });

  it('resolves actor names and applies the viewer-specific redaction', async () => {
    vi.mocked(repo.listAuditEvents).mockResolvedValue({ items: [row()] as never, nextCursor: null });

    const full = await list(mainAdmin, { limit: 50 });
    expect(full.items[0]).toMatchObject({ actor: { id: 'admin-1', name: 'Asha (HO)', role: 'main_admin' }, before: { mobile: '9876543210' }, ip: '10.0.0.1' });

    const co = await list(coAdmin, { limit: 50 });
    expect(co.items[0]).toMatchObject({ before: { mobile: '98xxxxxx10', customerName: 'Meera' } });
    expect(co.items[0]!.ip).toBeUndefined();

    const ro = await list(readOnly, { limit: 50 });
    expect(ro.items[0]).toMatchObject({ before: { customerName: '[redacted]' } });
  });

  it('shows the role in place of a name for system (actor-less) rows', async () => {
    vi.mocked(repo.listAuditEvents).mockResolvedValue({ items: [row({ actorId: null, actorRole: 'system', actorScope: 'system' })] as never, nextCursor: null });
    const page = await list(mainAdmin, { limit: 50 });
    expect(page.items[0]!.actor).toEqual({ id: null, name: 'system', role: 'system', scope: 'system' });
  });
});

describe('trail / entryTrail', () => {
  it('trail is admin-only', async () => {
    await expect(trail(dealerCtx, 'dealer', 'dealer-1')).rejects.toMatchObject({ code: 'permission_denied' });
    vi.mocked(repo.listAuditEventsForEntity).mockResolvedValue([row()] as never);
    await expect(trail(coAdmin, 'dealer', 'dealer-1')).resolves.toHaveLength(1);
  });

  it("dealer gets 404 for another dealer's entry, and 'Head office' for admin actors on their own", async () => {
    vi.mocked(findEntryById).mockResolvedValueOnce({ id: 'ent-1', dealerId: 'dealer-9' } as never);
    await expect(entryTrail(dealerCtx, 'ent-1')).rejects.toMatchObject({ code: 'entry_not_found' });

    vi.mocked(findEntryById).mockResolvedValueOnce({ id: 'ent-1', dealerId: 'dealer-1' } as never);
    vi.mocked(repo.listAuditEventsForEntity).mockResolvedValue([
      row({ action: 'entry.submitted', entityType: 'entry', entityId: 'ent-1', actorId: 'user-1', actorRole: 'dealer_manager', actorScope: 'dealer' }),
      row({ id: 2, action: 'entry.approved', entityType: 'entry', entityId: 'ent-1' }),
    ] as never);

    const items = await entryTrail(dealerCtx, 'ent-1');
    expect(items[0]!.actor).toMatchObject({ name: 'Ravi', scope: 'dealer' });
    expect(items[1]!.actor).toEqual({ id: null, name: 'Head office', role: 'admin', scope: 'admin' });
    expect(items[1]!.requestId).toBeUndefined();
    expect(repo.listAuditEventsForEntity).toHaveBeenCalledWith(expect.anything(), 'entry', 'ent-1');
  });

  it('an admin viewing an entry trail sees the real actor', async () => {
    vi.mocked(findEntryById).mockResolvedValueOnce({ id: 'ent-1', dealerId: 'dealer-1' } as never);
    vi.mocked(repo.listAuditEventsForEntity).mockResolvedValue([row({ entityType: 'entry', entityId: 'ent-1' })] as never);
    const items = await entryTrail(coAdmin, 'ent-1');
    expect(items[0]!.actor).toMatchObject({ id: 'admin-1', name: 'Asha (HO)' });
  });
});
