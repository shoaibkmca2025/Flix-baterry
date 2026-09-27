import test from 'node:test';
import assert from 'node:assert/strict';
import { creditNoteFor, creditNotes, creditOf } from '../data';
import type { CreditNote, Entry, State } from '../domain';

const entry = (id: string, over: Partial<Entry> = {}): Entry => ({
  id, apiId: `u-${id}`, dealerId: 'D1', type: 'Replacement', date: '2026-09-10', customer: '', place: 'Nashik',
  order: '', remarks: '', items: [{ id: 'i1', model: 'M1000', code: '26090001', serial: '0001', oldSerial: '26050001',
  mfg: '2026-09', rpl: '2026-09', rtn: '', wr: '', remarks: '' }], status: 'Approved', evidence: [],
  createdAt: '2026-09-10T06:00:00.000Z', retries: 0, ...over,
});
const note = (no: string, claimId: string, amount: number, over: Partial<CreditNote> = {}): CreditNote =>
  ({ no, claimId, amount, issuedAt: '2026-09-20T06:00:00.000Z', status: 'issued', ...over });

const base = (over: Partial<State> = {}): State => ({
  entries: [], batteries: [], dealers: [], models: [], movements: [], audits: [], customers: [], policies: [],
  notices: [], staff: [], reports: [], exports: [], overrides: [], cities: [], entryTypes: [], lastSync: '',
  offline: false, language: 'English', challans: [], ...over,
} as unknown as State);

test('signed in: the screens show the amount head office issued, never a computed one', () => {
  const e = entry('ENT-26-09-0001', { claimId: 'c1' });
  const state = base({ entries: [e], creditNotes: [note('CN-26-09-0007', 'c1', 3175)] });

  assert.equal(creditOf(state, e), 3175);
  assert.equal(creditNoteFor(state, e)?.no, 'CN-26-09-0007');

  const cn = creditNotes(state, 'D1');
  assert.equal(cn.credited.length, 1);
  assert.equal(cn.credited[0].no, 'CN-26-09-0007');   // the server's number, not one built from the entry id
  assert.equal(cn.credited[0].amount, 3175);
  assert.equal(cn.monthTotal, 3175);
});

test('an approved claim with no note yet shows nothing, rather than a made-up figure', () => {
  const e = entry('ENT-26-09-0002', { claimId: 'c2' });
  const state = base({ entries: [e], creditNotes: [] });   // signed in, none issued for this one
  assert.equal(creditOf(state, e), 0);
  assert.equal(creditNotes(state, 'D1').credited.length, 0);
});

test('a reversed note is worth nothing and drops off the list', () => {
  const e = entry('ENT-26-09-0003', { claimId: 'c3' });
  const state = base({ entries: [e], creditNotes: [note('CN-26-09-0008', 'c3', 4000, { status: 'reversed' })] });
  assert.equal(creditOf(state, e), 0);
  assert.equal(creditNotes(state, 'D1').credited.length, 0);
});

test('the month total follows the Asia/Kolkata calendar, like the server', () => {
  const e1 = entry('ENT-1', { claimId: 'c1' }), e2 = entry('ENT-2', { claimId: 'c2' });
  // 30 Sep 20:30 UTC is already 1 Oct in India — it must NOT count as September
  const state = base({ entries: [e1, e2], creditNotes: [
    note('CN-1', 'c1', 1000, { issuedAt: '2026-09-30T13:30:00.000Z' }),   // 30 Sep 19:00 IST
    note('CN-2', 'c2', 2000, { issuedAt: '2026-09-30T20:30:00.000Z' }),   // 1 Oct 02:00 IST
  ] });
  const cn = creditNotes(state, 'D1');
  assert.equal(cn.credited.length, 2);
  assert.equal(cn.credited.filter(c => c.date.startsWith('2026-09-30')).length, 2);
});

test('preview mode (no server) still works off the demo values', () => {
  const e = entry('ENT-26-09-0004');
  const state = base({ entries: [e] });                    // no creditNotes key at all
  assert.equal(creditOf(state, e), 0);                     // M1000 has no demo value — correct, it is a real product
  const demo = entry('ENT-26-09-0005', { items: [{ ...e.items[0], model: 'M5' }] });
  assert.equal(creditOf(base({ entries: [demo] }), demo), 4250);
});
