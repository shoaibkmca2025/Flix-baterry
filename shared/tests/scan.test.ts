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
// the client's own catalogue, as the apps pass it: id and model number together, because a
// digits-only barcode names the model NUMBER and nothing else
const MODELS = [
  { id: 'SS2500', modelNo: '2500' }, { id: 'MG2500', modelNo: '2500' }, { id: 'KDIN60', modelNo: 'DIN60' },
  { id: 'M1000', modelNo: '1000' }, { id: 'N1000', modelNo: '1000' }, { id: 'O1000', modelNo: '1000' },
  { id: 'GPM1000', modelNo: '1000' }, { id: 'GPI700', modelNo: '700' }, { id: 'SE1800', modelNo: '1800' },
  { id: 'Q1350', modelNo: '1350' },
];
const LENGTHS = [7, 8, 9];
const read = (label: string) => readLabel(label, MODELS, LENGTHS);

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

/* ---------- an address is asked for once (client, 4 Oct 2026) ---------- */

import { placeOf, addressLine, inheritedArea } from '../data';

test('a request takes its place off the shop, in the order a person would say it', () => {
  assert.equal(placeOf({ place: 'MIDC Ambad', city: 'Nashik' }), 'MIDC Ambad');
  assert.equal(placeOf({ place: '', city: 'Nashik' }), 'Nashik', 'the town when there is no area');
  assert.equal(placeOf({ place: '  ', city: '  ' }), '', 'and nothing when the record says nothing');
  assert.equal(placeOf(undefined), '');
});

test('the whole address reads as one line, skipping what is not on record', () => {
  assert.equal(
    addressLine({ address: 'Shop 4', place: 'MIDC', city: 'Sinnar', district: 'Nashik', state: 'Maharashtra' }),
    'Shop 4 · MIDC · Sinnar · Nashik · Maharashtra');
  // a shop recorded before districts existed has none, and the line simply does without it
  assert.equal(addressLine({ address: 'Shop 4', city: 'Nashik', state: 'Maharashtra' }), 'Shop 4 · Nashik · Maharashtra');
  assert.equal(addressLine(undefined), '');
});

test('a new shop starts in its distributor\'s area, and nothing else of his', () => {
  const parent = { state: 'Maharashtra', district: 'Nashik', city: 'Nashik', address: 'His shop' };
  assert.deepEqual(inheritedArea(parent), { state: 'Maharashtra', district: 'Nashik' });
  // the town and street are the new shop's own — they are never carried over
  assert.deepEqual(Object.keys(inheritedArea(parent)), ['state', 'district']);
  assert.deepEqual(inheritedArea(undefined), { state: '', district: '' });
});

/**
 * What the barcode itself carries.
 *
 * The printed line has spaces — "M 1000 2609 0676" — but a Code 128 barcode is half the width
 * when it holds digits alone, so that is often what is encoded: 100026090676, the model number
 * with the code run together. There are no letters to find a product by, so the whole run came
 * back as one impossible code and the serial was wrong (client, 4 Oct 2026).
 */
test('a digits-only barcode still gives the right code, whatever else it can tell', () => {
  // several products are "1000" — M, N, O and GP M — so the plate is left to be chosen, and
  // the code is right either way
  assert.deepEqual(read('100026090676'), { modelId: '', code: '26090676', serial: '0676', mfg: '2026-09', valid: true });
  assert.deepEqual(read('250026090493'), { modelId: '', code: '26090493', serial: '0493', mfg: '2026-09', valid: true });
  // only one product is "1350", so that one is known outright
  assert.deepEqual(read('135026090001'), { modelId: 'Q1350', code: '26090001', serial: '0001', mfg: '2026-09', valid: true });
});

test('every way this label could be encoded reads to the same battery', () => {
  const same = ['M 1000 2609 0676', 'M100026090676', 'M1000 26090676', 'M-1000-2609-0676', '100026090676', '26090676'];
  for (const enc of same) {
    const r = read(enc);
    assert.equal(r.code, '26090676', `${enc} gave ${r.code}`);
    assert.equal(r.serial, '0676');
    assert.equal(r.mfg, '2026-09');
    assert.equal(r.valid, true);
  }
  // and where the letters are there, the product comes with it
  assert.equal(read('M 1000 2609 0676').modelId, 'M1000');
  assert.equal(read('M100026090676').modelId, 'M1000');
});

/**
 * The barcode is a linear one — ITF, EAN-13 or UPC-A (client, 4 Oct 2026). Each hands back
 * digits, and each has its own habits about leading zeros.
 */
test('a linear barcode reads whatever padding it arrives with', () => {
  // ITF: plain digits, always an even count — which is what the client's labels have (12, 12, 10)
  assert.equal(read('100026090676').code, '26090676');
  assert.equal(read('6026090023').code, '26090023');
  // EAN-13 adds a leading zero to a 12-digit UPC-A; the model number is still found behind it
  assert.deepEqual(read('0135026090001'), { modelId: 'Q1350', code: '26090001', serial: '0001', mfg: '2026-09', valid: true });
  // and a printer that pads the model number to a fixed width does not hide it either
  assert.equal(read('0100026090676').code, '26090676');
});
