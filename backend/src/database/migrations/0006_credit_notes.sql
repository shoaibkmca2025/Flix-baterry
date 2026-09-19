ALTER TABLE "credit_notes" ADD COLUMN "settled_ref" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "reversed_reason" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "adjusted_by" uuid;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_dealer_idx" ON "credit_notes" USING btree ("dealer_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_issued_idx" ON "credit_notes" USING btree ("dealer_id","issued_at");--> statement-breakpoint
-- Dealers read their own credit notes (d37). The role seed is ON CONFLICT DO NOTHING, so an
-- already-seeded database needs the grant applied here (idempotent: skips roles that have it).
UPDATE "roles" SET "template_permissions" = array_append("template_permissions", 'credits.read')
WHERE "key" IN ('dealer_user', 'dealer_manager') AND NOT ('credits.read' = ANY("template_permissions"));
