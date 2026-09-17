CREATE TYPE "public"."entry_status" AS ENUM('submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('replacement', 'sales_return', 'regular_sales');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"dealer_id" uuid NOT NULL,
	"entry_type" "entry_type" NOT NULL,
	"entry_date" text NOT NULL,
	"place" text NOT NULL,
	"customer_name" text,
	"remarks" text,
	"total_qty" integer DEFAULT 0 NOT NULL,
	"status" "entry_status" DEFAULT 'submitted' NOT NULL,
	"gps" text,
	"signature" text,
	"cover_told_at" timestamp with time zone,
	"submitted_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"model_id" text NOT NULL,
	"battery_code" text NOT NULL,
	"battery_code_entered" text NOT NULL,
	"old_battery_code" text,
	"old_battery_code_entered" text,
	"fault_code" text,
	"remarks" text,
	"battery_id" uuid,
	"old_battery_id" uuid,
	"claim_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entries" ADD CONSTRAINT "entries_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entry_items" ADD CONSTRAINT "entry_items_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entry_items" ADD CONSTRAINT "entry_items_model_id_battery_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."battery_models"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entries_dealer_status_idx" ON "entries" USING btree ("dealer_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entry_items_entry_idx" ON "entry_items" USING btree ("entry_id");