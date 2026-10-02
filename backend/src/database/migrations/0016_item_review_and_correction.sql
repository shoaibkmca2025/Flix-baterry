ALTER TABLE "entry_items" ADD COLUMN "review_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entry_items" ADD COLUMN "review_started_by" uuid;--> statement-breakpoint
ALTER TABLE "entry_items" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "entry_items" ADD COLUMN "corrected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entry_items" ADD COLUMN "corrected_by" uuid;--> statement-breakpoint
ALTER TABLE "entry_items" ADD COLUMN "correction_reason" text;