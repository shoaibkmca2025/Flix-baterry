import { boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core';

// architecture.md §8.3 MASTER DATA — only `cities` for now (dealers.city_id needs it).
// battery_models / serial_rules / entry_types / reason_codes land with the batteries/entries modules.
export const cities = pgTable('cities', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  state: text('state').notNull(),
  active: boolean('active').notNull().default(true),
});
