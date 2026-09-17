CREATE TYPE "public"."battery_custodian" AS ENUM('company', 'dealer', 'customer', 'transit');--> statement-breakpoint
CREATE TYPE "public"."battery_origin" AS ENUM('entry', 'import', 'admin', 'migration');--> statement-breakpoint
CREATE TYPE "public"."battery_state" AS ENUM('available', 'allocated', 'sold', 'returned', 'replacement', 'repair', 'damaged', 'scrap');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "batteries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"battery_code" text NOT NULL,
	"battery_code_entered" text NOT NULL,
	"serial_no" text NOT NULL,
	"model_id" text NOT NULL,
	"mfg_month" char(7),
	"state" "battery_state" DEFAULT 'available' NOT NULL,
	"custodian" "battery_custodian" DEFAULT 'company' NOT NULL,
	"dealer_id" uuid,
	"origin" "battery_origin" NOT NULL,
	"not_on_record" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batteries_battery_code_unique" UNIQUE("battery_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "battery_models" (
	"id" text PRIMARY KEY NOT NULL,
	"family" text NOT NULL,
	"type" text NOT NULL,
	"capacity" text,
	"warranty_months" integer DEFAULT 24 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "batteries" ADD CONSTRAINT "batteries_model_id_battery_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."battery_models"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "batteries" ADD CONSTRAINT "batteries_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batteries_model_idx" ON "batteries" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batteries_dealer_idx" ON "batteries" USING btree ("dealer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batteries_state_idx" ON "batteries" USING btree ("state");