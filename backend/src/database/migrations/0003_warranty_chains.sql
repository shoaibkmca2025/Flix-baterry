CREATE TABLE IF NOT EXISTS "replacement_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"old_battery_id" uuid NOT NULL,
	"new_battery_id" uuid NOT NULL,
	"chain_id" uuid NOT NULL,
	"replaced_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replacement_links_new_battery_id_unique" UNIQUE("new_battery_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warranty_chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_battery_id" uuid NOT NULL,
	"warranty_start" date NOT NULL,
	"warranty_expiry" date NOT NULL,
	"term_months" integer DEFAULT 24 NOT NULL,
	"replacement_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warranty_chains_root_battery_id_unique" UNIQUE("root_battery_id")
);
--> statement-breakpoint
ALTER TABLE "batteries" ADD COLUMN "chain_id" uuid;--> statement-breakpoint
ALTER TABLE "batteries" ADD COLUMN "replaced_from_id" uuid;--> statement-breakpoint
ALTER TABLE "batteries" ADD COLUMN "replaced_by_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "replacement_links" ADD CONSTRAINT "replacement_links_old_battery_id_batteries_id_fk" FOREIGN KEY ("old_battery_id") REFERENCES "public"."batteries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "replacement_links" ADD CONSTRAINT "replacement_links_new_battery_id_batteries_id_fk" FOREIGN KEY ("new_battery_id") REFERENCES "public"."batteries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "replacement_links" ADD CONSTRAINT "replacement_links_chain_id_warranty_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."warranty_chains"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_chains" ADD CONSTRAINT "warranty_chains_root_battery_id_batteries_id_fk" FOREIGN KEY ("root_battery_id") REFERENCES "public"."batteries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "replacement_links_old_idx" ON "replacement_links" USING btree ("old_battery_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "replacement_links_chain_idx" ON "replacement_links" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batteries_chain_idx" ON "batteries" USING btree ("chain_id");