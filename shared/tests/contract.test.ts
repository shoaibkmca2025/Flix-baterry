import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntryBody } from '../api/entry-body';
import { EntryCreateBody } from '../../backend/src/modules/entries/entries.validation';

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
  // a sales return has no old battery and no fault
  assert.equal(sent(entry({ type: 'Sales Return', items: [{ ...base.items[0]!, oldSerial: '', fault: '' }] })).success, true);
});

test('the server refuses a replacement with no fault — so the apps must ask for one', () => {
  const r = sent(entry({ items: [{ ...entry().items[0]!, fault: '' }] }));
  assert.equal(r.success, false);
  // both the dealer app and the console now collect this before sending (shared/data entryErrors)
  assert.equal(r.success === false && r.error.issues[0]!.path.join('.'), 'items.0.faultCode');
});
