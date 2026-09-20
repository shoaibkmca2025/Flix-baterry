// Pure, no I/O — the stock-ledger transition rules from architecture.md §9.6.

export const BATTERY_STATES = ['available', 'allocated', 'sold', 'returned', 'replacement', 'repair', 'damaged', 'scrap'] as const;
export type BatteryState = (typeof BATTERY_STATES)[number];

export const CUSTODIANS = ['company', 'dealer', 'customer', 'transit'] as const;
export type Custodian = (typeof CUSTODIANS)[number];

// Allowed state transitions (architecture.md §9.6 table). `scrap` is terminal.
export const STOCK_TRANSITIONS: Record<BatteryState, readonly BatteryState[]> = {
  available: ['allocated', 'sold', 'replacement', 'repair', 'damaged', 'scrap'],
  allocated: ['available', 'sold', 'returned'],
  sold: ['returned', 'repair'],
  replacement: ['returned', 'repair'],
  returned: ['repair', 'available', 'damaged', 'scrap'],
  repair: ['available', 'returned', 'damaged', 'scrap'],
  damaged: ['repair', 'scrap'],
  scrap: [],
};

/**
 * Whether a movement from → to is allowed. `from = null` is the creation movement (any state).
 * A movement that keeps the state but changes custody (e.g. returned/dealer → returned/transit
 * when the old battery is dispatched) is a custody move and always allowed — except out of scrap.
 */
export function canTransition(from: BatteryState | null, to: BatteryState): boolean {
  if (from === null) return true;
  if (from === to) return from !== 'scrap';
  return STOCK_TRANSITIONS[from].includes(to);
}

export function isTerminal(state: BatteryState): boolean {
  return STOCK_TRANSITIONS[state].length === 0;
}
