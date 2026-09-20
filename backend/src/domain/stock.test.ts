import { describe, expect, it } from 'vitest';
import { BATTERY_STATES, STOCK_TRANSITIONS, canTransition, isTerminal } from './stock';

describe('stock transitions — architecture.md §9.6, exhaustive', () => {
  it('matches the table row for row', () => {
    expect(STOCK_TRANSITIONS).toEqual({
      available: ['allocated', 'sold', 'replacement', 'repair', 'damaged', 'scrap'],
      allocated: ['available', 'sold', 'returned'],
      sold: ['returned', 'repair'],
      replacement: ['returned', 'repair'],
      returned: ['repair', 'available', 'damaged', 'scrap'],
      repair: ['available', 'returned', 'damaged', 'scrap'],
      damaged: ['repair', 'scrap'],
      scrap: [],
    });
  });

  it('every pair agrees with canTransition; only scrap is terminal', () => {
    for (const from of BATTERY_STATES) {
      for (const to of BATTERY_STATES) {
        const expected = from === to ? from !== 'scrap' : STOCK_TRANSITIONS[from].includes(to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
      expect(isTerminal(from)).toBe(from === 'scrap');
    }
  });

  it('creation (from null) may land in any state; a custody-only move keeps the state', () => {
    for (const to of BATTERY_STATES) expect(canTransition(null, to)).toBe(true);
    expect(canTransition('returned', 'returned')).toBe(true); // dealer → transit → company
    expect(canTransition('scrap', 'scrap')).toBe(false);
  });

  it('the V1 flow is a legal path: sold → returned → (transit, company) → repair | scrap', () => {
    expect(canTransition('sold', 'returned')).toBe(true);
    expect(canTransition('replacement', 'returned')).toBe(true);
    expect(canTransition('returned', 'repair')).toBe(true);
    expect(canTransition('returned', 'scrap')).toBe(true);
    expect(canTransition('sold', 'scrap')).toBe(false); // must come back first
  });
});
