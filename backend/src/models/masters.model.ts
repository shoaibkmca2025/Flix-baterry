import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// architecture.md §8.3 MASTER DATA — cities + battery_models so far.
// serial_rules / entry_types / reason_codes land with the entries module.
export const cities = pgTable('cities', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  state: text('state').notNull(),
  active: boolean('active').notNull().default(true),
});

// Plate types — the letter on the label ("M", "N", "L", …) that, together with the model
// number, decides the warranty term (client insight, 22 Sep 2026 — memory.md D-11).
export const plateTypes = pgTable('plate_types', {
  code: text('code').primaryKey(), // 'M'
  label: text('label').notNull(), // 'M plates'
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

// architecture.md §8.3 — id is the human-readable model code itself, and since 22 Sep 2026
// that code is the PLATE + MODEL NUMBER combination ("M2200" = plate M, model 2200): one row
// per combination the factory makes, carrying that combination's warranty term. The dealer
// app's two dropdowns (plate, model number) compose this id. Rows from before the change
// ("M5", "B5", …) keep their ids so existing batteries still resolve; they are inactive so
// they no longer appear in the dropdowns. V1 trims reorder_threshold/sort.
export const batteryModels = pgTable('battery_models', {
  id: text('id').primaryKey(),
  family: text('family').notNull(), // legacy grouping letter; equals `plate` for new rows
  plate: text('plate').references(() => plateTypes.code), // 'M'
  modelNo: text('model_no'), // '2200'
  type: text('type').notNull(),
  capacity: text('capacity'),
  warrantyMonths: integer('warranty_months').notNull().default(24), // the term BEFORE the grace months (settings warranty.grace_months)
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
