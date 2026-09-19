CREATE TABLE IF NOT EXISTS "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"battery_id" uuid NOT NULL,
	"from_state" "battery_state",
	"to_state" "battery_state" NOT NULL,
	"from_custodian" "battery_custodian",
	"to_custodian" "battery_custodian" NOT NULL,
	"from_dealer_id" uuid,
	"to_dealer_id" uuid,
	"entry_id" uuid,
	"claim_id" uuid,
	"reason_code" text NOT NULL,
	"reason_text" text,
	"correction_of_id" uuid,
	"posted_by" uuid,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_battery_id_batteries_id_fk" FOREIGN KEY ("battery_id") REFERENCES "public"."batteries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_dealer_id_dealers_id_fk" FOREIGN KEY ("from_dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_dealer_id_dealers_id_fk" FOREIGN KEY ("to_dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_battery_idx" ON "stock_movements" USING btree ("battery_id","posted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_to_dealer_idx" ON "stock_movements" USING btree ("to_dealer_id","posted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_posted_idx" ON "stock_movements" USING btree ("posted_at");--> statement-breakpoint
-- architecture.md §8.4 — the ledger is append-only at the database level, like audit_events.
CREATE TRIGGER no_update_delete BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_change();
