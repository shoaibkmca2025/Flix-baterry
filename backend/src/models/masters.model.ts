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
// The code printed in front of the model number on the label. For a flooded/automotive
// battery it is a single letter whose ALPHABET POSITION is the number of plates — G=7, I=9,
// M=13, W=23 (client's grid, 25 Sep 2026; memory.md D-12). For the tubular range it is a
// two-character series code (SE, S5, ME, SG, BE, MG, SS) that carries no plate count.
export const plateTypes = pgTable('plate_types', {
  code: text('code').primaryKey(), // 'M' | 'SG'
  label: text('label').notNull(), // '13 plates'
  plateCount: integer('plate_count'), // 13; null for the tubular series codes
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
  modelNo: text('model_no'), // '1000' | 'DIN75' | 'H29'
  brand: text('brand').notNull().default('felix'), // 'felix' | 'gold_power' (the red 'GP' case)
  type: text('type').notNull(),
  capacity: text('capacity'),
  warrantyMonths: integer('warranty_months').notNull().default(24), // the term BEFORE the grace months (settings warranty.grace_months)
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// The plants that make Felix batteries (client, 28 Sep 2026 — memory.md D-19). When an old
// battery reaches head office, the admin reads its label and tags it with the plant that MADE
// it, so failures can be counted per plant. Head office adds and renames plants itself
// (masters.manage). A plant that batteries are tagged with is switched off, never deleted: they
// keep pointing at it and their history must still read "Branch 2". Only a plant nothing is
// counted under can be deleted (a mistake, or one added too early).
export const plants = pgTable('plants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  active: boolean('active').notNull().default(true),
  // the plant's details — where it is and who to call there; all optional, admin-only (never in
  // the public /masters bundle)
  location: text('location'),
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
