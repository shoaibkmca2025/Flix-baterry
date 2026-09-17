import { boolean, char, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dealers } from './identity.model';
import { batteryModels } from './masters.model';

// architecture.md §8.3 BATTERIES — V1 trims location_id/customer_id/first_seen_entry_id
// (inventory_locations, customers, entries don't exist yet). chain_id/replaced_from_id/
// replaced_by_id are back (memory.md D-03, closed 2026-09-17 — chain-based warranty
// confirmed): plain uuid columns, not enforced FKs, since warranty_chains.rootBatteryId
// already has a real FK back to batteries.id and both files importing each other would
// be a circular import. Enforced at the application layer (batteries.repository.ts) instead.
export const batteryState = pgEnum('battery_state', ['available', 'allocated', 'sold', 'returned', 'replacement', 'repair', 'damaged', 'scrap']);
export const batteryCustodian = pgEnum('battery_custodian', ['company', 'dealer', 'customer', 'transit']);
export const batteryOrigin = pgEnum('battery_origin', ['entry', 'import', 'admin', 'migration']);

export const batteries = pgTable(
  'batteries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batteryCode: text('battery_code').notNull().unique(), // normalised — I-4, always text
    batteryCodeEntered: text('battery_code_entered').notNull(),
    serialNo: text('serial_no').notNull(),
    modelId: text('model_id')
      .notNull()
      .references(() => batteryModels.id),
    mfgMonth: char('mfg_month', { length: 7 }), // 'YYYY-MM'
    state: batteryState('state').notNull().default('available'),
    custodian: batteryCustodian('custodian').notNull().default('company'),
    dealerId: uuid('dealer_id').references(() => dealers.id),
    origin: batteryOrigin('origin').notNull(),
    notOnRecord: boolean('not_on_record').notNull().default(false),
    chainId: uuid('chain_id'), // -> warranty_chains.id, see file comment above
    replacedFromId: uuid('replaced_from_id'), // -> batteries.id (the old battery, if this one replaced it)
    replacedById: uuid('replaced_by_id'), // -> batteries.id (the new battery, if this one was replaced)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('batteries_model_idx').on(t.modelId),
    index('batteries_dealer_idx').on(t.dealerId),
    index('batteries_state_idx').on(t.state),
    index('batteries_chain_idx').on(t.chainId),
  ],
);
