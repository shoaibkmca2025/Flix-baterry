CREATE TYPE "public"."cover_case" AS ENUM('extension', 'expired');--> statement-breakpoint
CREATE TYPE "public"."special_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "batteries" ADD COLUMN "no_warranty" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "batteries" ADD COLUMN "no_warranty_reason" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "special_status" "special_status";--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "special_decided_by" uuid;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "special_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "special_reason" text;--> statement-breakpoint
ALTER TABLE "entry_items" ADD COLUMN "cover_case" "cover_case";--> statement-breakpoint
ALTER TABLE "entry_items" ADD COLUMN "cover_term_end" text;--> statement-breakpoint
ALTER TABLE "entry_items" ADD COLUMN "cover_end" text;