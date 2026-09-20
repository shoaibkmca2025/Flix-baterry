import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { batteries, batteryCustodian, batteryState } from './batteries.model';
import { dealers, users } from './identity.model';

// architecture.md §8.3 stock_movements, trimmed for V1: no location ids (inventory_locations
// doesn't exist), no challan_id (returns is folded into claims), reason code is free text
// (no reason_codes master yet). APPEND-ONLY — forbid_change trigger in the migration; a
// mistake is corrected by a compensating movement pointing back via correction_of_id.
// Owned by the stock module: every state/custody change of a battery goes through
// stock.postMovementInTx, which writes the row here AND applies it to batteries.
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batteryId: uuid('battery_id')
      .notNull()
      .references(() => batteries.id),
    fromState: batteryState('from_state'), // null = the battery was created by this movement
    toState: batteryState('to_state').notNull(),
    fromCustodian: batteryCustodian('from_custodian'),
    toCustodian: batteryCustodian('to_custodian').notNull(),
    fromDealerId: uuid('from_dealer_id').references(() => dealers.id),
    toDealerId: uuid('to_dealer_id').references(() => dealers.id),
    entryId: uuid('entry_id'), // -> entries.id (plain column: entries.model imports batteries; avoid the cycle)
    claimId: uuid('claim_id'), // -> warranty_claims.id
    reasonCode: text('reason_code').notNull(), // 'entry_approved' | 'claim_dispatched' | 'claim_received' | 'inspection' | 'manual' | 'correction'
    reasonText: text('reason_text'),
    correctionOfId: uuid('correction_of_id'), // -> stock_movements.id
    postedBy: uuid('posted_by').references(() => users.id), // null = system job
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('stock_movements_battery_idx').on(t.batteryId, t.postedAt), index('stock_movements_to_dealer_idx').on(t.toDealerId, t.postedAt), index('stock_movements_posted_idx').on(t.postedAt)],
);
