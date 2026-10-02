ALTER TYPE "public"."entry_status" ADD VALUE 'with_distributor';--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "distributor_decided_by" uuid;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "distributor_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "distributor_reason" text;