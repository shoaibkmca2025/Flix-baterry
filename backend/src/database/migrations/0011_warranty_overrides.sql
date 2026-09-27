CREATE TYPE "public"."override_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warranty_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"chain_id" uuid NOT NULL,
	"battery_id" uuid NOT NULL,
	"dealer_id" uuid,
	"days" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "override_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"expiry_before" date,
	"expiry_after" date,
	CONSTRAINT "warranty_overrides_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "warranty_chains" ADD COLUMN "grace_months" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "warranty_chains" ADD COLUMN "expiry_before_override" date;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_overrides" ADD CONSTRAINT "warranty_overrides_chain_id_warranty_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."warranty_chains"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_overrides" ADD CONSTRAINT "warranty_overrides_battery_id_batteries_id_fk" FOREIGN KEY ("battery_id") REFERENCES "public"."batteries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_overrides" ADD CONSTRAINT "warranty_overrides_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warranty_overrides_status_idx" ON "warranty_overrides" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warranty_overrides_chain_idx" ON "warranty_overrides" USING btree ("chain_id");--> statement-breakpoint
-- Chains opened before this migration stored term+grace merged in term_months, and every one
-- of them was created under the 2-month grace of memory.md D-11. Split them back out so a
-- chain keeps the numbers it was actually opened with (D-16); the DATES are untouched, so no
-- battery's cover changes — only how the chain explains itself.
UPDATE "warranty_chains" SET "grace_months" = 2, "term_months" = GREATEST("term_months" - 2, 1)
 WHERE "grace_months" = 0 AND "term_months" > 2;
