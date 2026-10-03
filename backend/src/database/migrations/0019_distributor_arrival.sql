ALTER TABLE "entry_items" ADD COLUMN "distributor_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entry_items" ADD COLUMN "distributor_received_by" uuid;