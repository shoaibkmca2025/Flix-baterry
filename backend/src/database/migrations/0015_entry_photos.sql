CREATE TABLE IF NOT EXISTS "entry_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"entry_item_id" uuid,
	"tag" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_photos_tile_uq" UNIQUE NULLS NOT DISTINCT("entry_id","entry_item_id","tag")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entry_photos" ADD CONSTRAINT "entry_photos_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entry_photos" ADD CONSTRAINT "entry_photos_entry_item_id_entry_items_id_fk" FOREIGN KEY ("entry_item_id") REFERENCES "public"."entry_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entry_photos_entry_idx" ON "entry_photos" USING btree ("entry_id");