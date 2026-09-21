CREATE TYPE "public"."challan_status" AS ENUM('dispatched', 'received');--> statement-breakpoint
CREATE TYPE "public"."return_stage" AS ENUM('in_transit', 'received', 'testing', 'repaired', 'scrapped', 'closed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "challan_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challan_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"entry_item_id" uuid NOT NULL,
	"battery_code" text NOT NULL,
	"model_id" text NOT NULL,
	"fault_code" text,
	"stage" "return_stage" DEFAULT 'in_transit' NOT NULL,
	"stage_note" text,
	"staged_by" uuid,
	"staged_at" timestamp with time zone,
	"shortage" boolean DEFAULT false NOT NULL,
	CONSTRAINT "challan_lines_entry_item_id_unique" UNIQUE("entry_item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "challans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"no" text NOT NULL,
	"dealer_id" uuid NOT NULL,
	"vehicle_no" text,
	"driver_name" text,
	"line_count" integer DEFAULT 0 NOT NULL,
	"status" "challan_status" DEFAULT 'dispatched' NOT NULL,
	"dispatched_by" uuid NOT NULL,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challans_no_unique" UNIQUE("no")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "challan_lines" ADD CONSTRAINT "challan_lines_challan_id_challans_id_fk" FOREIGN KEY ("challan_id") REFERENCES "public"."challans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "challan_lines" ADD CONSTRAINT "challan_lines_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "challan_lines" ADD CONSTRAINT "challan_lines_entry_item_id_entry_items_id_fk" FOREIGN KEY ("entry_item_id") REFERENCES "public"."entry_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "challans" ADD CONSTRAINT "challans_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "challan_lines_challan_idx" ON "challan_lines" USING btree ("challan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "challan_lines_entry_idx" ON "challan_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "challans_dealer_status_idx" ON "challans" USING btree ("dealer_id","status");