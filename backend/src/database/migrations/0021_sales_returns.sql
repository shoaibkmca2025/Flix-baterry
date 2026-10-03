-- Sales returns become a flow of their own (client, 3 Oct 2026).
--
-- A sales return is one battery that goes back to the company and comes home working, with the
-- same serial. It is not a replacement: there is no old battery, no new battery and no warranty
-- chain. Everything below makes room for that without touching what a replacement already is.

-- Which kind of sales return: stock that never sold, or one that is faulty. Null on a replacement.
CREATE TYPE return_kind AS ENUM ('unsold', 'defective');--> statement-breakpoint
ALTER TABLE entries ADD COLUMN return_kind return_kind;--> statement-breakpoint

-- A claim is raised for a sales return too, and runs the same course. But a sales-return claim
-- has no chain and no new battery, so the three columns that assumed a replacement become
-- optional. Every claim already on record keeps exactly what it has.
-- old_battery_id stays required: it is "the battery that went back", which a sales return has
-- too — it is the whole point of one.
ALTER TABLE warranty_claims ALTER COLUMN chain_id DROP NOT NULL;--> statement-breakpoint
ALTER TABLE warranty_claims ALTER COLUMN new_battery_id DROP NOT NULL;--> statement-breakpoint

-- Which kind of request a claim belongs to, so counts can be split by tag (RP / SR) without
-- joining back to the entry. Everything already raised is a replacement.
CREATE TYPE claim_kind AS ENUM ('replacement', 'sales_return');--> statement-breakpoint
ALTER TABLE warranty_claims ADD COLUMN kind claim_kind NOT NULL DEFAULT 'replacement';--> statement-breakpoint

-- One challan carries both, in two sections. The line says which section it belongs to, so the
-- challan can be grouped and printed without reading back through the entries.
ALTER TABLE challan_lines ADD COLUMN kind claim_kind NOT NULL DEFAULT 'replacement';
