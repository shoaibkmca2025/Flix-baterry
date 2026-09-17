import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// architecture.md §8.3 MASTER DATA — cities + battery_models so far.
// serial_rules / entry_types / reason_codes land with the entries module.
export const cities = pgTable('cities', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  state: text('state').notNull(),
  active: boolean('active').notNull().default(true),
});

// architecture.md §8.3 — id is the human-readable model code itself ("M5"), not a uuid.
// V1 trims reorder_threshold/sort (stock module territory, not built yet).
export const batteryModels = pgTable('battery_models', {
  id: text('id').primaryKey(),
  family: text('family').notNull(), // 'M' | 'B' | 'S' | 'I'
  type: text('type').notNull(),
  capacity: text('capacity'),
  warrantyMonths: integer('warranty_months').notNull().default(24),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
