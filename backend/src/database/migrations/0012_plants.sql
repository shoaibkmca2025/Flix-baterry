CREATE TABLE IF NOT EXISTS "plants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plants_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "batteries" ADD COLUMN "plant_id" uuid;--> statement-breakpoint
ALTER TABLE "challan_lines" ADD COLUMN "plant_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "batteries" ADD CONSTRAINT "batteries_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "challan_lines" ADD CONSTRAINT "challan_lines_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "challan_lines_plant_idx" ON "challan_lines" USING btree ("plant_id");--> statement-breakpoint
-- The starting plants (client, 28 Sep 2026 — memory.md D-19): placeholder names head office
-- renames from the admin console. Inserted only into an EMPTY table, so this can never undo a
-- rename or bring back a plant that was switched off. created_at is staggered because it is
-- the order the dropdown lists them in.
INSERT INTO "plants" ("name", "created_at")
SELECT v.name, now() + v.pos * interval '1 second'
FROM (VALUES ('Main plant', 0), ('Branch 1', 1), ('Branch 2', 2), ('Branch 3', 3)) AS v(name, pos)
WHERE NOT EXISTS (SELECT 1 FROM "plants");
