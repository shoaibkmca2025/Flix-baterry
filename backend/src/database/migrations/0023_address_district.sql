-- An address is asked for as State, then District, then the town typed by hand (client,
-- 4 Oct 2026). Two things follow.
--
-- A district is a new idea here: nothing recorded one before.
ALTER TABLE dealers ADD COLUMN district text;--> statement-breakpoint

-- And the town is no longer one of a handful the company listed. `cities` holds 4 rows for 1
-- state; a shop may be anywhere in India, and no list of Indian towns is small enough to keep
-- here. The name is stored as typed, and city_id stays for the shops that already have one.
ALTER TABLE dealers ADD COLUMN city_name text;--> statement-breakpoint
ALTER TABLE dealers ALTER COLUMN city_id DROP NOT NULL;--> statement-breakpoint

-- every shop already on record keeps the town it has, now written where the new ones go
UPDATE dealers d SET city_name = c.name FROM cities c WHERE c.id = d.city_id AND d.city_name IS NULL;
