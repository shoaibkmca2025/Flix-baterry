import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntryBody } from '../api/entry-body';
import { ENTRY_TYPES } from '../domain';
import { EntryCreateBody, shopEntryIssues } from '../../backend/src/modules/entries/entries.validation';

/**
 * What the apps SEND, checked against what the server ACCEPTS.
 *
 * Head office's "Record an entry" could not record a replacement at all for weeks: the server
 * requires a fault on every replacement and the console had no field for one, so every attempt
 * was refused (client, 2 Oct 2026). Nothing caught it, because each side was tested on its own.
 * This runs the real request builder through the real zod schema, so the two cannot drift again.
 */
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'ENT-1', dealerId: '11111111-2222-3333-4444-555555555555', type: 'Replacement', date: '2026-10-02',
  customer: 'Aman', place: 'Nashik', order: '', remarks: '', status: 'Draft', evidence: [],
  createdAt: '2026-10-02T10:00:00Z', retries: 0,
  items: [{ id: 'i1', model: 'M5', oldModel: 'M5', code: '26100001', serial: '0001', mfg: '2026-10',
            oldSerial: '26080001', fault: 'Low backup', rpl: '2026-10', rtn: '', wr: '', remarks: '' }],
  ...over,
});

const sent = (e: ReturnType<typeof entry>) =>
  EntryCreateBody.safeParse({ ...buildEntryBody(e as never), dealerId: e.dealerId, entryDate: e.date });

test('everything the apps send is something the server accepts', () => {
  const base = entry();
  assert.equal(sent(base).success, true);
  // a new battery may be 7, 8 or 9 digits (client, 2 Oct 2026) — all three must reach the server
  for (const [code, serial] of [['2610001', '001'], ['26100001', '0001'], ['261000012', '00012']]) {
    const e = entry({ items: [{ ...base.items[0]!, code, serial }] });
    assert.equal(sent(e).success, true, `${code} (${code.length} digits) was refused`);
  }
  // several batteries on one request
  assert.equal(sent(entry({ items: [0, 1, 2].map(n => ({ ...base.items[0]!, id: `i${n}`, code: `2610000${n + 1}`, oldSerial: `2608000${n + 1}` })) })).success, true);
  // a sales return has no old battery and no fault, but must say which kind it is
  assert.equal(sent(entry({ type: 'Sales Return', returnKind: 'Unsold', items: [{ ...base.items[0]!, oldSerial: '', fault: '' }] })).success, true);
  // a dealer may still name a fault on a defective one
  assert.equal(sent(entry({ type: 'Sales Return', returnKind: 'Defective', items: [{ ...base.items[0]!, oldSerial: '', fault: 'Leakage' }] })).success, true);
});

/**
 * What a SHOP's request must say, beyond the shape of the body.
 *
 * These moved out of the schema when head office stopped being held to them (client,
 * 3 Oct 2026): the schema cannot see who is calling, so the service applies them to a dealer's
 * request only. They are still the bar both apps collect against before sending.
 */
const shopIssue = (e: ReturnType<typeof entry>) =>
  shopEntryIssues({ ...buildEntryBody(e as never), dealerId: e.dealerId, entryDate: e.date } as never);

test("a shop's replacement must name a fault, and a sales return must say which kind", () => {
  assert.equal(shopIssue(entry()), null);
  assert.equal(shopIssue(entry({ items: [{ ...entry().items[0]!, fault: '' }] }))?.field, 'items.0.faultCode');
  assert.equal(shopIssue(entry({ items: [{ ...entry().items[0]!, oldSerial: '' }] }))?.field, 'items.0.oldCode');

  const salesReturn = (over = {}) => entry({ type: 'Sales Return', items: [{ ...entry().items[0]!, oldSerial: '', fault: '' }], ...over });
  assert.equal(shopIssue(salesReturn())?.field, 'returnKind');
  assert.equal(shopIssue(salesReturn({ returnKind: 'Unsold' })), null);
  // a fault is allowed on a sales return, never demanded
  assert.equal(shopIssue(entry({ type: 'Sales Return', returnKind: 'Defective', items: [{ ...entry().items[0]!, oldSerial: '', fault: 'Leakage' }] })), null);
});

test('the body itself still carries everything those rules read', () => {
  // head office sends the same shape; only the judgement is skipped for it
  const body = buildEntryBody(entry({ type: 'Sales Return', returnKind: 'Defective', items: [{ ...entry().items[0]!, oldSerial: '', fault: 'Leakage' }] }) as never);
  assert.equal(body.entryType, 'sales_return');
  assert.equal(body.returnKind, 'defective');
  assert.equal(body.items[0]!.faultCode, 'leakage');
});

/**
 * Two entry types, and nothing else.
 *
 * The console offered thirteen — Goods Return, For Charging, Given for Demo — while the server
 * has only `replacement` and `sales_return`, and this builder turned everything that was not a
 * replacement into a sales return. Choosing "Given for Demo" therefore recorded a sales return,
 * with nothing anywhere to say so (client, 3 Oct 2026).
 */
test('both apps offer the same two entry types, and the server knows them', () => {
  assert.deepEqual([...ENTRY_TYPES], ['Replacement', 'Sales Return']);
  for (const type of ENTRY_TYPES) {
    const e = entry({ type, ...(type === 'Sales Return' ? { returnKind: 'Unsold', items: [{ ...entry().items[0]!, oldSerial: '', fault: '' }] } : {}) });
    assert.equal(sent(e).success, true, `${type} was refused by the server`);
  }
});

test('a type that is not one of the two is refused here, not turned into a sales return', () => {
  for (const type of ['Goods Return', 'For Charging', 'Given for Demo', '']) {
    assert.throws(() => buildEntryBody(entry({ type }) as never), /is not an entry type/, `${type} slipped through`);
  }
});
