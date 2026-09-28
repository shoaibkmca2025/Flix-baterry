import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedForRefund, firstProblem, refunds } from '../data';
import type { Entry, State } from '../domain';

const entry = (id: string, over: Partial<Entry> = {}): Entry => ({
  id, apiId: `u-${id}`, dealerId: 'D1', type: 'Replacement', date: '2026-09-10', customer: '', place: 'Nashik',
  order: '', remarks: '', items: [{ id: 'i1', model: 'M1000', code: '26090001', serial: '0001', oldSerial: '26050001',
  mfg: '2026-09', rpl: '2026-09', rtn: '', wr: '', remarks: '' }], status: 'Approved', evidence: [],
  createdAt: '2026-09-10T06:00:00.000Z', retries: 0, ...over,
});
const base = (over: Partial<State> = {}): State => ({
  entries: [], batteries: [], dealers: [], models: [], movements: [], audits: [], customers: [], policies: [],
  notices: [], staff: [], reports: [], exports: [], overrides: [], cities: [], entryTypes: [], lastSync: '',
  offline: false, language: 'English', challans: [], ...over,
} as unknown as State);

// Client, 28 Sep 2026 (memory.md D-20): the dealer is shown only that a battery is approved for
// refund — no amount, anywhere. The accounts team works the refund out and pays it.

test('an approved replacement is approved for refund, and nothing carries an amount', () => {
  const e = entry('ENT-26-09-0001', { claimId: 'c1', claimStatus: 'approved', decidedAt: '2026-09-20T06:00:00.000Z' });
  const state = base({ entries: [e] });
  assert.equal(approvedForRefund(e), true);
  const r = refunds(state, 'D1');
  assert.equal(r.approved.length, 1);
  assert.equal(r.approved[0].entry.id, 'ENT-26-09-0001');
  assert.doesNotMatch(JSON.stringify(r), /amount|₹/);
});

test('an entry approved while its claim is still undecided is being checked, not approved for refund', () => {
  const e = entry('ENT-26-09-0002', { claimId: 'c2', claimStatus: 'raised' });
  const r = refunds(base({ entries: [e] }), 'D1');
  assert.equal(approvedForRefund(e), false);
  assert.equal(r.approved.length, 0);
  assert.equal(r.checking.length, 1);
});

test('a refused claim is refused, whether the entry or only its claim was refused', () => {
  const a = entry('ENT-1', { status: 'Rejected' });
  const b = entry('ENT-2', { claimId: 'c2', claimStatus: 'refused' });
  const r = refunds(base({ entries: [a, b] }), 'D1');
  assert.equal(r.refused.length, 2);
  assert.equal(r.approved.length + r.checking.length, 0);
});

test('a sale is never a refund', () => {
  const e = entry('ENT-3', { type: 'Sale' });
  assert.equal(approvedForRefund(e), false);
  assert.equal(refunds(base({ entries: [e] }), 'D1').approved.length, 0);
});

test('"this month" follows the Asia/Kolkata calendar, like the server', () => {
  const now = new Date();
  const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 7);
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString();
  const e1 = entry('ENT-1', { claimId: 'c1', claimStatus: 'approved', decidedAt: now.toISOString() });
  const e2 = entry('ENT-2', { claimId: 'c2', claimStatus: 'approved', decidedAt: lastMonth });
  const r = refunds(base({ entries: [e1, e2] }), 'D1');
  assert.equal(r.approved.length, 2);
  assert.equal(r.monthCount, r.approved.filter((x) => ist(new Date(x.date)) === ist(now)).length);
  assert.equal(r.monthCount, 1);
});

test('a request refused by head office keeps its reason, so it is not a mystery later', () => {
  const e = entry('ENT-26-09-0009', { status: 'Draft' });
  e.items[0].exception = 'Warranty expired on 2026-08-31. Request an admin override before submitting.';
  const state = base({ entries: [e], models: [{ id: 'M1000', plate: 'M', modelNo: '1000', months: 12, active: true } as never],
    serialDigitLengths: [7, 8] } as never);
  // local validation has nothing to say about it — the reason came from the server
  assert.match(String(firstProblem(e, state)), /Warranty expired/);
});

test('a draft that is merely unfinished reports the field that still needs work', () => {
  const e = entry('ENT-26-09-0010', { status: 'Draft' });
  e.items[0].code = '';                        // nothing typed yet
  const state = base({ entries: [e], models: [{ id: 'M1000', plate: 'M', modelNo: '1000', months: 12, active: true } as never],
    serialDigitLengths: [7, 8] } as never);
  assert.ok(firstProblem(e, state), 'an unfinished draft must still say what is missing');
});
