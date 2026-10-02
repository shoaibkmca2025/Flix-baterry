import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newEntry, newItem, type Entry } from '../domain';
import { batteryUnits, unitKey } from '../data';

// A replacement with two old batteries, as the store holds it after a sync: each item carries
// its own claim, stage and decision (mapping.toItem). Head office handles them one by one.
const twoBatteries = (): Entry => ({
  ...newEntry('d-1'), id: 'ENT-26-10-0003', apiId: 'e-uuid', status: 'Under Review', returnState: 'Received', claimId: 'claim-1', claimStatus: 'approved',
  items: [
    { ...newItem(), id: 'item-1', model: 'K800', oldSerial: 'K80025090025', claimId: 'claim-1', claimStatus: 'approved', status: 'Approved', returnState: 'Closed' },
    { ...newItem(), id: 'item-2', model: 'K800', oldSerial: 'K80025090026', claimId: 'claim-2', claimStatus: 'received', status: 'Under Review', returnState: 'Received' },
  ],
});

test('head office sees one row per old battery, each with its own claim, stage and decision', () => {
  const units = batteryUnits(twoBatteries());
  assert.equal(units.length, 2);
  assert.deepEqual(units.map(u => [u.items.length, u.items[0]!.oldSerial, u.itemId, u.claimId, u.claimStatus, u.status, u.returnState, u.part]), [
    [1, 'K80025090025', 'item-1', 'claim-1', 'approved', 'Approved', 'Closed', 'battery 1 of 2'],
    [1, 'K80025090026', 'item-2', 'claim-2', 'received', 'Under Review', 'Received', 'battery 2 of 2'],
  ]);
  assert.notEqual(unitKey(units[0]!), unitKey(units[1]!));
  assert.ok(units.every(u => u.id === 'ENT-26-10-0003' && u.apiId === 'e-uuid')); // still the same request
});

test('a one-battery request, or one that is not a replacement, is its own row', () => {
  const one = { ...twoBatteries(), items: [twoBatteries().items[0]!] };
  assert.deepEqual(batteryUnits(one), [one]);
  const ret = { ...twoBatteries(), type: 'Sales Return' };
  assert.deepEqual(batteryUnits(ret), [ret]);
  assert.equal(unitKey(one), 'ENT-26-10-0003');
});

test('a battery with nothing of its own yet falls back to the request', () => {
  const e = { ...twoBatteries(), status: 'Submitted' as const, returnState: 'In transit', items: twoBatteries().items.map(it => ({ ...it, claimId: undefined, claimStatus: undefined, status: undefined, returnState: undefined })) };
  assert.deepEqual(batteryUnits(e).map(u => [u.status, u.returnState]), [['Submitted', 'In transit'], ['Submitted', 'In transit']]);
});
