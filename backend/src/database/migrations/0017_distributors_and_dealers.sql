CREATE TYPE "public"."dealer_kind" AS ENUM('distributor', 'dealer');--> statement-breakpoint
ALTER TYPE "public"."registered_via" ADD VALUE 'distributor';--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "kind" "dealer_kind" DEFAULT 'distributor' NOT NULL;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "distributor_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dealers" ADD CONSTRAINT "dealers_distributor_id_dealers_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dealers_distributor_idx" ON "dealers" USING btree ("distributor_id");--> statement-breakpoint
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_kind_parent_ck" CHECK (("dealers"."kind" = 'dealer') = ("dealers"."distributor_id" is not null));