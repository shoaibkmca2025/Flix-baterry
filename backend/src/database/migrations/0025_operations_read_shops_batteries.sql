-- Operations staff decide requests, so they must see who sent each one (client, 6 Oct 2026). Without
-- these two the console could not load the shop list for them and showed each shop's internal id
-- instead of its name, and "Batteries on record 0". Read only: Operations still cannot change a
-- shop, approve one, or touch stock. Added only where missing, so running it twice changes nothing.
UPDATE roles SET template_permissions = array_append(template_permissions, 'dealers.read')
  WHERE key = 'operations' AND NOT ('dealers.read' = ANY(template_permissions));--> statement-breakpoint
UPDATE roles SET template_permissions = array_append(template_permissions, 'batteries.read')
  WHERE key = 'operations' AND NOT ('batteries.read' = ANY(template_permissions));
