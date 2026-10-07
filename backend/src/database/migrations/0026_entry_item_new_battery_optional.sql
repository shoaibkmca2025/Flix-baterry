-- Head office records some replacements before the new battery's number is known: a special
-- case it handles by hand, where the claim is really about the OLD battery that came back
-- (client, 7 Oct 2026).
--
-- The new battery's number is therefore optional on the item. It is still required before the
-- request can be APPROVED — approval is what creates the battery's record and anchors the
-- warranty chain to it, and neither can be done without a number. Head office fills it in from
-- "Correct this battery" when the number arrives.
--
-- A shop's own request is unaffected: both apps ask for it and the server still requires it of
-- them, as it always has.
ALTER TABLE entry_items ALTER COLUMN battery_code DROP NOT NULL;--> statement-breakpoint
ALTER TABLE entry_items ALTER COLUMN battery_code_entered DROP NOT NULL;
