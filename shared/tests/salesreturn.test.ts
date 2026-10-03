import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTRY_TYPES, RETURN_KINDS, tagOf } from '../domain';
import { challanHtml, travellingSerial } from '../data';
import type { Challan, Dealer } from '../domain';

/**
 * Sales returns (client, 3 Oct 2026): a battery goes back to the company and comes home working,
 * with the same serial. It rides on the same challan as the replacements, in its own section,
 * and carries an SR tag so it is never mistaken for one.
 */
test('a request wears the tag its reference gives it', () => {
  assert.equal(tagOf({ id: 'SR-26-10-0001', type: 'Sales Return' }), 'SR');
  assert.equal(tagOf({ id: 'RP-26-10-0004', type: 'Replacement' }), 'RP');
  // a request numbered before the tags existed keeps its ENT- reference and falls back to its type
  assert.equal(tagOf({ id: 'ENT-26-09-0414', type: 'Replacement' }), 'RP');
  assert.equal(tagOf({ id: 'ENT-26-09-0415', type: 'Sales Return' }), 'SR');
});

test('both kinds of sales return exist, and nothing else', () => {
  assert.deepEqual([...RETURN_KINDS], ['Unsold', 'Defective']);
  assert.deepEqual([...ENTRY_TYPES], ['Replacement', 'Sales Return']);
});

test('what travels back: a replacement sends its old battery, a sales return sends itself', () => {
  const it = { code: 'M526100042', oldSerial: 'M526040001' };
  assert.equal(travellingSerial({ type: 'Replacement' }, it), 'M526040001');
  assert.equal(travellingSerial({ type: 'Sales Return' }, it), 'M526100042');
});

const dealer = { id: 'D1', name: 'Felix Factory', city: 'Nashik', place: 'MIDC', code: 'FPP-014' } as Dealer;
const challan = (rows: Challan['rows']): Challan => ({
  no: 'CHL-26-10-0007', dealerId: 'D1', at: '2026-10-03T06:00:00Z', vehicle: 'MH15 AB 1234', driver: 'Ravi', entryIds: [], rows,
});
const row = (serial: string, kind: 'RP' | 'SR'): Challan['rows'][number] =>
  ({ serial, model: 'M5', ref: `${kind}-26-10-0001`, fault: 'Leakage', kind });

test('one challan prints both kinds as two sections, each numbered and totalled on its own', () => {
  const html = challanHtml(challan([row('A1', 'RP'), row('B1', 'SR'), row('A2', 'RP')]), dealer);
  const rp = html.indexOf('Replacements'), sr = html.indexOf('Sales returns');
  assert.ok(rp > -1 && sr > -1, 'both sections are on the page');
  assert.ok(rp < sr, 'replacements come first');
  assert.ok(html.includes('Replacements — old batteries · 2'), 'the replacement section counts its own');
  assert.ok(html.includes('Sales returns · 1'), 'the sales-return section counts its own');
  assert.ok(html.includes('<span>3</span>'), 'and the challan totals both');
});

test('a section with nothing in it is left off the page', () => {
  const html = challanHtml(challan([row('A1', 'RP')]), dealer);
  assert.ok(html.includes('Replacements'));
  assert.ok(!html.includes('Sales returns'), 'an empty section is not printed');
});

test('a challan from before the two sections existed reads as replacements', () => {
  // rows written before `kind` existed carry none, and a replacement is what they were
  const html = challanHtml(challan([{ serial: 'A1', model: 'M5', ref: 'ENT-26-09-0414', fault: 'Leakage' }]), dealer);
  assert.ok(html.includes('Replacements — old batteries · 1'));
  assert.ok(!html.includes('Sales returns'));
});

/* ---------- a serial that has been back before ---------- */

import { salesReturnsOf, countByTag, tagSummary } from '../data';
import type { State } from '../domain';

const st = (entries: unknown[]): State => ({
  entries, batteries: [], dealers: [], models: [], movements: [], audits: [], customers: [], policies: [],
  notices: [], staff: [], reports: [], exports: [], overrides: [], cities: [], entryTypes: [], lastSync: '',
  offline: false, language: 'English', challans: [],
} as never);
const sr = (id: string, code: string, over: Record<string, unknown> = {}) => ({
  id, dealerId: 'D1', type: 'Sales Return', date: '2026-10-01', customer: '', place: 'Nashik', order: '', remarks: '',
  status: 'Approved', evidence: [], createdAt: '', retries: 0, returnKind: 'Defective',
  items: [{ id: 'i1', model: 'M5', code, serial: code.slice(-4), oldSerial: '', mfg: '2026-05', rpl: '', rtn: '', wr: '', remarks: '' }],
  ...over,
});

test('a serial that went back before is found when it turns up again', () => {
  const state = st([sr('SR-26-10-0001', '26050195'), sr('SR-26-09-0004', '26050195', { date: '2026-09-02', decidedAt: '2026-09-03' })]);
  const found = salesReturnsOf(state, '26050195', 'M5');
  assert.equal(found.length, 2);
  assert.equal(found[0]!.id, 'SR-26-10-0001', 'newest first');
  // a serial with no history of its own finds nothing
  assert.deepEqual(salesReturnsOf(state, '26050196', 'M5'), []);
  assert.deepEqual(salesReturnsOf(state, '', 'M5'), []);
});

test('a draft, an unsent or a refused return is not held against a battery', () => {
  for (const status of ['Draft', 'Pending sync', 'Rejected', 'Cancelled']) {
    assert.deepEqual(salesReturnsOf(st([sr('SR-26-10-0002', '26050195', { status })]), '26050195', 'M5'), [], status);
  }
});

test('a replacement in the history is not a sales return', () => {
  const state = st([sr('RP-26-10-0003', '26050195', { type: 'Replacement' })]);
  assert.deepEqual(salesReturnsOf(state, '26050195', 'M5'), []);
});

/* ---------- claims are counted, never valued ---------- */

test('claims are split by tag as quantities', () => {
  const rows = [
    { id: 'RP-26-10-0001', type: 'Replacement' }, { id: 'RP-26-10-0002', type: 'Replacement' },
    { id: 'SR-26-10-0001', type: 'Sales Return' },
  ];
  assert.deepEqual(countByTag(rows), { RP: 2, SR: 1 });
  assert.equal(tagSummary({ RP: 2, SR: 1 }), '2 RP · 1 SR');
  // a group with only one kind says only that kind, never "0 SR"
  assert.equal(tagSummary({ RP: 5, SR: 0 }), '5 RP');
  assert.equal(tagSummary({ RP: 0, SR: 3 }), '3 SR');
  assert.equal(tagSummary({ RP: 0, SR: 0 }), '');
});

/* ---------- what head office records (client, 3 Oct 2026) ---------- */

test('a challan says what it is carrying and what head office put on it', () => {
  const rows: Challan['rows'] = [
    { serial: 'A1', model: 'M5', ref: 'RP-26-10-0001', fault: 'Leakage', kind: 'RP' },
    { serial: 'A2', model: 'M5', ref: 'RP-26-10-0002', fault: 'Leakage', kind: 'RP', byAdmin: true },
    { serial: 'B1', model: 'M5', ref: 'SR-26-10-0001', fault: '—', kind: 'SR', byAdmin: true },
  ];
  const mix = {
    RP: rows.filter(r => (r.kind ?? 'RP') === 'RP').length,
    SR: rows.filter(r => r.kind === 'SR').length,
    admin: rows.filter(r => r.byAdmin).length,
  };
  assert.deepEqual(mix, { RP: 2, SR: 1, admin: 2 });
  // the two counts are independent: a head-office line is still a line of its own section
  assert.equal(mix.RP + mix.SR, rows.length);
});

test('a challan line written before either flag existed reads as a shop replacement', () => {
  const r: Challan['rows'][number] = { serial: 'A1', model: 'M5', ref: 'ENT-26-09-0414', fault: 'Leakage' };
  assert.equal(r.kind ?? 'RP', 'RP');
  assert.equal(!!r.byAdmin, false);
});
