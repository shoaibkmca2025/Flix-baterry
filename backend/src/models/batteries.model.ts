import { boolean, char, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dealers } from './identity.model';
import { batteryModels } from './masters.model';

// architecture.md §8.3 BATTERIES — V1 trims location_id/customer_id/chain_id/replaced_*/
// first_seen_entry_id (inventory_locations, customers, warranty_chains, entries don't exist
// yet). Warranty for V1 is computed live from mfg_month (memory.md D-03, still open) rather
// than tracked via a chain, so batteries doesn't need chain state to do its job.
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('batteries_model_idx').on(t.modelId), index('batteries_dealer_idx').on(t.dealerId), index('batteries_state_idx').on(t.state)],
);
