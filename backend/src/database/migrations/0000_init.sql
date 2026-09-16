CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM('ok', 'denied', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_role" text NOT NULL,
	"actor_scope" text NOT NULL,
	"actor_dealer_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_ref" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"outcome" "audit_outcome" NOT NULL,
	"request_id" text,
	"ip" "inet",
	"device_id" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "counters" (
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "counters_kind_period_pk" PRIMARY KEY("kind","period")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_actor_at_idx" ON "audit_events" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_at_idx" ON "audit_events" USING btree ("at");--> statement-breakpoint
-- architecture.md §8.4 / rules.md #2 — append-only tables physically refuse UPDATE/DELETE, not just by convention.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;--> statement-breakpoint
CREATE TRIGGER no_update_delete BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION forbid_change();