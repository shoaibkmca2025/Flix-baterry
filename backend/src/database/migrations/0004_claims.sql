CREATE TYPE "public"."claim_disposition" AS ENUM('repair', 'scrap', 'hold');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('raised', 'awaiting_return', 'received', 'checked', 'approved', 'refused');--> statement-breakpoint
CREATE TYPE "public"."credit_note_status" AS ENUM('issued', 'settled', 'reversed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"no" text NOT NULL,
	"dealer_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "credit_note_status" DEFAULT 'issued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_no_unique" UNIQUE("no"),
	CONSTRAINT "credit_notes_claim_id_unique" UNIQUE("claim_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warranty_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"dealer_id" uuid NOT NULL,
	"chain_id" uuid NOT NULL,
	"old_battery_id" uuid NOT NULL,
	"new_battery_id" uuid NOT NULL,
	"status" "claim_status" DEFAULT 'raised' NOT NULL,
	"finding_code" text,
	"condition_note" text,
	"disposition" "claim_disposition",
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"credit_note_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warranty_claims_ref_unique" UNIQUE("ref"),
	CONSTRAINT "warranty_claims_new_battery_id_unique" UNIQUE("new_battery_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_claim_id_warranty_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."warranty_claims"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_chain_id_warranty_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."warranty_chains"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_old_battery_id_batteries_id_fk" FOREIGN KEY ("old_battery_id") REFERENCES "public"."batteries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_new_battery_id_batteries_id_fk" FOREIGN KEY ("new_battery_id") REFERENCES "public"."batteries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warranty_claims_dealer_idx" ON "warranty_claims" USING btree ("dealer_id","status");