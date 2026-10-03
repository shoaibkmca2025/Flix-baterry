import { test } from 'node:test';
import assert from 'node:assert/strict';
import { above } from '../domain';

/**
 * Who a screen names when it names the tier above.
 *
 * The dealer app showed "Head office decision" to everyone, so a dealer was pointed at an office
 * he never deals with (client, 3 Oct 2026). Both branches are checked here because a dealer login
 * cannot be exercised from the distributor's account the team tests with.
 */
test('a dealer is told about his distributor, by name when his session knows it', () => {
  const plain = above({ kind: 'Dealer' });
  assert.equal(plain.isDealer, true);
  assert.equal(plain.above, 'your distributor');
  assert.equal(plain.Above, 'Your distributor');
  assert.equal(plain.aboveName, 'your distributor');

  const named = above({ kind: 'Dealer', distributor: { id: 'd1', name: 'Felix Factory', mobile: '9000000000', contact: 'Rao' } });
  assert.equal(named.aboveName, 'Felix Factory');
});

test('a distributor is told about head office', () => {
  const d = above({ kind: 'Distributor' });
  assert.equal(d.isDealer, false);
  assert.equal(d.above, 'head office');
  assert.equal(d.Above, 'Head office');
});

test('a shop from before the two tiers keeps the wording it has always had', () => {
  // Dealer.kind is absent on every shop created before the tiers existed, and means 'Distributor'
  assert.equal(above({}).above, 'head office');
  assert.equal(above(undefined).above, 'head office');
});
