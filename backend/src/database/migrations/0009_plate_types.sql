CREATE TABLE IF NOT EXISTS "plate_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entry_items" ADD COLUMN "old_model_id" text;--> statement-breakpoint
ALTER TABLE "battery_models" ADD COLUMN "plate" text;--> statement-breakpoint
ALTER TABLE "battery_models" ADD COLUMN "model_no" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "battery_models" ADD CONSTRAINT "battery_models_plate_plate_types_code_fk" FOREIGN KEY ("plate") REFERENCES "public"."plate_types"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- memory.md D-11: the pre-22-Sep model rows stay resolvable for batteries already on the
-- register but leave the dropdowns (the seed is ON CONFLICT DO NOTHING, so this is done here).
UPDATE "battery_models" SET "active" = false WHERE "plate" IS NULL AND "id" IN ('M3','M5','M7','B5','S5','I700');
