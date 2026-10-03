-- An entry head office recorded itself, rather than one a shop sent in (client, 3 Oct 2026).
--
-- The distributor must be able to tell them apart: a request he never raised turns up in his
-- queue and on his challan, and "where did this come from" has to have an answer on the screen.
ALTER TABLE entries ADD COLUMN by_admin boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- Carried onto the challan line at dispatch, so a van's load can be read without joining back
-- through every entry.
ALTER TABLE challan_lines ADD COLUMN by_admin boolean NOT NULL DEFAULT false;
