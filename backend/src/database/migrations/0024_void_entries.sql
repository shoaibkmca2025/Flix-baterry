ALTER TYPE "public"."entry_status" ADD VALUE 'void';--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "void_reason" text;
