ALTER TABLE "battery_models" ADD COLUMN "brand" text DEFAULT 'felix' NOT NULL;--> statement-breakpoint
ALTER TABLE "plate_types" ADD COLUMN "plate_count" integer;--> statement-breakpoint
-- memory.md D-13 (25 Sep 2026): the factory restarts the 4-digit serial at 1 on the 26th of
-- every month AND counts separately per product, so the 8 digits are NOT unique on their own —
-- 'M1000 26090001' and 'S1000 26090001' are two different batteries. A battery's identity is
-- therefore its full printed label: product code + digits. Existing rows carry their product
-- in model_id, so the identity can be rebuilt from what is already stored.
UPDATE "batteries" SET "battery_code" = "model_id" || "battery_code"
 WHERE "battery_code" ~ '^[0-9]{8}$';--> statement-breakpoint
UPDATE "entry_items" SET "battery_code" = "model_id" || "battery_code"
 WHERE "battery_code" ~ '^[0-9]{8}$';--> statement-breakpoint
UPDATE "entry_items" SET "old_battery_code" = COALESCE("old_model_id", "model_id") || "old_battery_code"
 WHERE "old_battery_code" ~ '^[0-9]{8}$';--> statement-breakpoint
-- 'I700' was a placeholder row that nothing references; 'I 700' is a real product in the
-- client's catalogue and needs that id (memory.md D-12).
DELETE FROM "battery_models" WHERE "id" = 'I700'
 AND NOT EXISTS (SELECT 1 FROM "batteries" WHERE "model_id" = 'I700')
 AND NOT EXISTS (SELECT 1 FROM "entry_items" WHERE "model_id" = 'I700' OR "old_model_id" = 'I700');--> statement-breakpoint
-- every pre-catalogue row stays resolvable for the batteries that reference it, but leaves the
-- dealer's dropdowns; the seed re-activates the real catalogue rows straight after.
UPDATE "battery_models" SET "active" = false;
