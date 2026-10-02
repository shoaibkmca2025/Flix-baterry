import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newEntry, newItem, type Entry, type State } from '../domain';
import { isDealerShop, networkEntries, refunds, toSendBack } from '../data';

// Head office → distributor → dealer (client, 2 Oct 2026). In a distributor's app the store
// holds his own requests and his dealers'; dealer-1 is the distributor, dealer-1a his dealer.
const rep = (id: string, dealerId: string, status: Entry['status']): Entry =>
  ({ ...newEntry(dealerId), id, status, date: '2026-10-02', createdAt: `2026-10-02T0${id.length % 9}:00:00Z`, items: [{ ...newItem(), oldSerial: `OLD-${id}`, code: `NEW-${id}` }] });
const state = { entries: [
  rep('E1', 'dealer-1', 'Submitted'),           // his own, sent to head office
  rep('E2', 'dealer-1a', 'With distributor'),   // his dealer's, still waiting for him
  rep('E3', 'dealer-1a', 'Submitted'),          // his dealer's, approved by him → head office
  { ...rep('E4', 'dealer-1', 'Draft') },
] } as unknown as State;

test("a distributor sends back his own old batteries and those of his dealers' requests he approved", () => {
  assert.deepEqual(toSendBack(state, 'dealer-1').map(e => e.id), ['E1']);
  assert.deepEqual(toSendBack(state, 'dealer-1', true).map(e => e.id).sort(), ['E1', 'E3']); // E2 waits for his approval
  assert.deepEqual(networkEntries(state, 'dealer-1').map(e => e.id).sort(), ['E1', 'E2', 'E3', 'E4']);
  assert.deepEqual(refunds(state, 'dealer-1', true).checking.map(e => e.id).sort(), ['E1', 'E3']);
});

test('a shop is a distributor unless it says it is a dealer (every shop from before is one)', () => {
  assert.equal(isDealerShop({ kind: 'Dealer' }), true);
  assert.equal(isDealerShop({ kind: 'Distributor' }), false);
  assert.equal(isDealerShop({}), false);
  assert.equal(isDealerShop(undefined), false);
});
