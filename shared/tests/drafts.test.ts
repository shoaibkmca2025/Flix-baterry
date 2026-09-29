import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryKey } from '../domain';

const base = { type: 'Replacement', dealerId: 'd-1' };
const item = (code: string, model: string, oldSerial = '', oldModel?: string) => ({ id: 'x', code, model, oldSerial, oldModel, serial: '', mfg: '', rpl: '', rtn: '', wr: '', remarks: '' });

test('a phone draft (typed digits) and the server copy (whole label) are the same request', () => {
  const draft = { ...base, items: [item('26052369', 'J700', '2605231', 'J700')] };
  const onServer = { ...base, items: [item('J70026052369', 'J700', 'J7002605231', 'J700')] };
  assert.equal(entryKey(draft), entryKey(onServer));
});

test('a different battery, dealer or type is a different request', () => {
  const draft = { ...base, items: [item('26052369', 'J700', '2605231', 'J700')] };
  assert.notEqual(entryKey(draft), entryKey({ ...draft, items: [item('26052370', 'J700', '2605231', 'J700')] }));
  assert.notEqual(entryKey(draft), entryKey({ ...draft, dealerId: 'd-2' }));
  assert.notEqual(entryKey(draft), entryKey({ ...draft, type: 'Sales Return' }));
});

test('item order does not matter', () => {
  const a = item('26050001', 'M1000'), b = item('26050002', 'M1000');
  assert.equal(entryKey({ ...base, items: [a, b] }), entryKey({ ...base, items: [b, a] }));
});

test('a replacement needs a photo of each new battery before it can go ahead; the draft keeps both serials', async () => {
  const { newEntry, newItem } = await import('../domain');
  const { needsNewBatteryPhoto, newPhotoTag } = await import('../data');
  const e = { ...newEntry('d-1'), items: [{ ...newItem(), code: '26090001', oldSerial: '2509001' }, { ...newItem(), code: '26090002', oldSerial: '2509002' }] };
  assert.equal(needsNewBatteryPhoto(e, 0), true);
  const withFirst = { ...e, evidence: ['file://new-1.jpg'], evidenceTags: [newPhotoTag(0)] };
  assert.equal(needsNewBatteryPhoto(withFirst, 0), false);
  assert.equal(needsNewBatteryPhoto(withFirst, 1), true); // each battery on the request has its own photo
  assert.equal(newPhotoTag(1), 'New label · item 2');
  assert.deepEqual(withFirst.items.map(it => [it.oldSerial, it.code]), [['2509001', '26090001'], ['2509002', '26090002']]);
  assert.equal(needsNewBatteryPhoto({ ...e, type: 'Sales Return' }, 0), false); // replacements only
});
