import { date, index, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { batteries } from './batteries.model';

// architecture.md §8.3 warranty_chains, trimmed for V1 (no policy versioning/overrides yet —
// term is a fixed 24 months, matching domain/warranty.ts's default). Confirmed 2026-09-17
// (memory.md D-03, closed): a replacement inherits the chain's original start date unchanged
// — the chain row is what makes that possible, since every battery in it points to the same
// warrantyStart/warrantyExpiry regardless of how many replacements deep it is.
export const warrantyChains = pgTable('warranty_chains', {
  id: uuid('id').primaryKey().defaultRandom(),
  rootBatteryId: uuid('root_battery_id')
    .notNull()
    .unique()
    .references(() => batteries.id),
  warrantyStart: date('warranty_start').notNull(),
  warrantyExpiry: date('warranty_expiry').notNull(),
  termMonths: integer('term_months').notNull().default(24),
  replacementCount: integer('replacement_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// architecture.md §8.3 replacement_links — APPEND-ONLY (I-2): "the table named replaced
// battery" the team asked for, with the old serial and new serial linked via battery id.
// Lives here, not batteries.model.ts, so it can hold real FKs to both batteries and
// warrantyChains without the circular import batteries.model.ts avoids (see its comment).
export const replacementLinks = pgTable(
  'replacement_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    oldBatteryId: uuid('old_battery_id')
      .notNull()
      .references(() => batteries.id),
    newBatteryId: uuid('new_battery_id')
      .notNull()
      .unique()
      .references(() => batteries.id),
    chainId: uuid('chain_id')
      .notNull()
      .references(() => warrantyChains.id),
    replacedAt: date('replaced_at').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('replacement_links_old_idx').on(t.oldBatteryId), index('replacement_links_chain_idx').on(t.chainId)],
);
