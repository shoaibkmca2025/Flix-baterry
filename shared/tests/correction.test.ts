import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fullCode, digitsOf, correctionOf } from '../domain';

/**
 * Correcting a serial from head office.
 *
 * A battery is stored as its whole label — the plate + model, then the digits (fullCode). The
 * correction box edits only the digits. It used to be opened with the whole label in it, so the
 * first keystroke stripped the letters and the length cap cut what was left: GPI700260245678
 * became 700260245 and saved as a different battery, silently (client, 3 Oct 2026).
 */
test('a stored label splits into the digits the box edits, and joins back to the same battery', () => {
  const stored = 'GPI700260245678';
  assert.equal(digitsOf(stored, 'GPI700'), '260245678');
  assert.equal(fullCode('GPI700', digitsOf(stored, 'GPI700')), stored);
});

test('putting the whole label in a digits-only box names a different battery', () => {
  // exactly what the box used to do: strip the letters, then cut to the longest allowed length
  const mangled = 'GPI700260245678'.replace(/\D/g, '').slice(0, 9);
  assert.equal(mangled, '700260245');
  assert.notEqual(fullCode('GPI700', mangled), 'GPI700260245678');
});

test('the box opens on digits only, with each half on its own product', () => {
  // not like-for-like: the old battery is another product, so its digits split by ITS prefix
  const c = correctionOf({ model: 'GPI700', code: 'GPI700260945678', oldModel: 'N2200', oldSerial: 'N220026041212' });
  assert.deepEqual(c, { model: 'GPI700', oldModel: 'N2200', code: '260945678', oldSerial: '26041212' });
  // and what is saved is the whole label again, unchanged where it was not edited
  assert.equal(fullCode(c.model, c.code), 'GPI700260945678');
  assert.equal(fullCode(c.oldModel, c.oldSerial), 'N220026041212');
});

test('a like-for-like replacement splits both halves by the one product', () => {
  const c = correctionOf({ model: 'GPI700', code: 'GPI700260945678', oldSerial: 'GPI700260245678' });
  assert.equal(c.oldModel, 'GPI700');
  assert.equal(c.code, '260945678');
  assert.equal(c.oldSerial, '260245678');
});

test('a sales return has no old battery, and the box does not ask for one', () => {
  assert.equal(correctionOf({ model: 'GPI700', code: 'GPI700260945678', oldSerial: '' }).oldSerial, '');
});
