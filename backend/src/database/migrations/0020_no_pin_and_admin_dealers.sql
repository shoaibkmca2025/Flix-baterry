-- A PIN code is not asked for anywhere any more (client, 3 Oct 2026). The column stays so the
-- PINs already collected are not thrown away, but nothing has to fill it from now on.
ALTER TABLE dealers ALTER COLUMN pin DROP NOT NULL;
