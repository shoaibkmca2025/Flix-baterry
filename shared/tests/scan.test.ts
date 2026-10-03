import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLabel, fullCode } from '../domain';

/**
 * Reading a Felix label (client, 4 Oct 2026).
 *
 * The three below are real labels, photographed off batteries. They print the whole thing with
 * spaces — "M 1000 2609 0676" — and the scanner hands that string back exactly as printed.
 *
 * Every scan used to be squeezed through /[A-Za-z]\d{3,4}-?\d{6,9}/ first, which wants the
 * letters jammed against the digits. With the spaces there it matched nothing, fell through to
 * "strip everything that is not a digit and take the first nine", and produced 100026090 — the
 * model number welded onto half the date. That is why a scan filled in no serial, no model and
 * no plate.
 */
const IDS = ['SS2500', 'KDIN60', 'M1000', 'GPM1000', 'MG2500', 'N1000', 'O1000', 'GPI700', 'SE1800', 'Q1350'];
const LENGTHS = [7, 8, 9];
const read = (label: string) => readLabel(label, IDS, LENGTHS);

test('the three labels on the client\'s own batteries read completely', () => {
  assert.deepEqual(read('SS 2500 26090493'), { modelId: 'SS2500', code: '26090493', serial: '0493', mfg: '2026-09', valid: true });
  assert.deepEqual(read('K DIN 60 2609 0023'), { modelId: 'KDIN60', code: '26090023', serial: '0023', mfg: '2026-09', valid: true });
  assert.deepEqual(read('M 1000 2609 0676'), { modelId: 'M1000', code: '26090676', serial: '0676', mfg: '2026-09', valid: true });
});

test('what each one is stored as — product and digits, never one without the other', () => {
  for (const [label, stored] of [
    ['SS 2500 26090493', 'SS250026090493'],
    ['K DIN 60 2609 0023', 'KDIN6026090023'],
    ['M 1000 2609 0676', 'M100026090676'],
  ]) {
    const r = read(label!);
    assert.equal(fullCode(r.modelId, r.code), stored);
  }
});

test('the old pre-chewing is what broke it — kept here so it is never put back', () => {
  const codeFrom = (d: string) => (d.match(/[A-Za-z]\d{3,4}-?\d{6,9}/)?.[0]) || (d.match(/\d{6,9}/)?.[0]) || d.replace(/\D/g, '').slice(0, 9);
  assert.equal(codeFrom('M 1000 2609 0676'), '100026090');          // the model welded to the date
  assert.equal(codeFrom('K DIN 60 2609 0023'), '602609002');        // likewise
  assert.equal(codeFrom('SS 2500 26090493'), '26090493');           // digits only — no product
  // and none of those is what the battery is
  assert.notEqual(read('M 1000 2609 0676').code, codeFrom('M 1000 2609 0676'));
});

test('a label with no spaces, and bare digits, read the same way', () => {
  assert.deepEqual(read('M100026090676'), { modelId: 'M1000', code: '26090676', serial: '0676', mfg: '2026-09', valid: true });
  // just the digits: the serial and month are read, and the product is left to be chosen
  assert.deepEqual(read('26090676'), { modelId: '', code: '26090676', serial: '0676', mfg: '2026-09', valid: true });
});

test('all three lengths survive a scan — 7, 8 and 9 digits', () => {
  assert.equal(read('M 1000 2609 676').code, '2609676');
  assert.equal(read('M 1000 2609 0676').code, '26090676');
  assert.equal(read('M 1000 2609 00676').code, '260900676');
});

test('a product the catalogue does not know still gives up its digits', () => {
  const r = read('ZZ 9999 26090001');
  // the digits are read and the month with them; the product is left blank rather than guessed,
  // so the screen asks for it instead of recording the battery under something invented
  assert.deepEqual(r, { modelId: '', code: '26090001', serial: '0001', mfg: '2026-09', valid: true });
});

test('a scan that is not a battery number at all is flagged, not accepted', () => {
  assert.equal(read('rubbish').valid, false);
  // a month that cannot exist is not a battery number either
  assert.equal(read('M 1000 2699 0676').valid, false);
});

/* ---------- where a shop is (client, 4 Oct 2026) ---------- */

import { STATES, districtsOf, addressErrors, withState, emptyAddress } from '../india';

test('every state and union territory is there, with its districts', () => {
  assert.equal(STATES.length, 35);
  assert.equal(STATES.filter((s, i) => STATES.indexOf(s) !== i).length, 0, 'no state listed twice');
  // the two changes made by hand to a list that predates 2019
  assert.ok(STATES.includes('Ladakh'), 'Ladakh became a union territory in 2019');
  assert.deepEqual(districtsOf('Ladakh'), ['Kargil', 'Leh']);
  assert.ok(!districtsOf('Jammu and Kashmir').includes('Leh'), 'and took Leh with it');
  assert.ok(STATES.includes('Dadra and Nagar Haveli and Daman and Diu'), 'merged in 2020');
  assert.ok(!STATES.some(s => s.includes('(UT)')), 'an address form says "Delhi", not "Delhi (NCT)"');
  // the client's own state, in full
  assert.equal(districtsOf('Maharashtra').length, 36);
  for (const d of ['Nashik', 'Dhule', 'Jalgaon', 'Pune', 'Mumbai City']) {
    assert.ok(districtsOf('Maharashtra').includes(d), `${d} is a district of Maharashtra`);
  }
});

test('an address is not complete until the state, district, town and street are there', () => {
  assert.deepEqual(Object.keys(addressErrors(emptyAddress())).sort(), ['address', 'city', 'district', 'state']);
  const full = { state: 'Maharashtra', district: 'Nashik', city: 'Sinnar', place: 'MIDC', address: 'Plot 4' };
  assert.deepEqual(addressErrors(full), {});
  // the town is typed, so any town in India is accepted — that is the whole point of option (c)
  assert.deepEqual(addressErrors({ ...full, city: 'Somewhere Nobody Listed' }), {});
  // a state that is not a state is not accepted
  assert.equal(addressErrors({ ...full, state: 'Atlantis' }).state, 'Choose the state from the list.');
});

test('changing the state drops a district that does not belong to it', () => {
  const a = { state: 'Maharashtra', district: 'Nashik', city: 'Sinnar', place: '', address: 'Plot 4' };
  assert.equal(withState(a, 'Gujarat').district, '', 'Nashik is not in Gujarat');
  assert.equal(withState(a, 'Maharashtra').district, 'Nashik', 'and choosing the same state keeps it');
});
