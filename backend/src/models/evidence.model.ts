import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { entries, entryItems } from './entries.model';

// A photo the dealer attached to a request (memory.md D-10: Neon Object Storage, 2 Oct 2026).
// The bytes live in the private `evidence` bucket under `object_key`; this row says which
// request — and which battery on it — the photo belongs to, and what it shows (`tag`: 'Old
// battery', 'New label', … as the dealer app labels its photo tiles). Head office reads it
// through a short-lived signed link, never a public URL.
export const entryPhotos = pgTable(
  'entry_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entries.id),
    entryItemId: uuid('entry_item_id').references(() => entryItems.id), // null = the request as a whole
    tag: text('tag').notNull(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    uploadedBy: uuid('uploaded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('entry_photos_entry_idx').on(t.entryId),
    // one photo per tile: sending a tile again (a retry, a retake) replaces it
    unique('entry_photos_tile_uq').on(t.entryId, t.entryItemId, t.tag).nullsNotDistinct(),
  ],
);
