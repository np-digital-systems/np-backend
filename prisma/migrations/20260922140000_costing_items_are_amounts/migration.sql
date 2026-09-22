-- costing_items_are_amounts
-- Hand-written SQL: two columns go and the constraints that required them.
-- Prisma will apply this in order and will not diff its contents.
--
-- An item was a quantity at a price — ten coconuts at 120 — on the reasoning
-- that a quote the temple could check against a shop bill was worth the two
-- extra columns. The committee does not cost that way: they agree a figure for
-- a head and, where it helps, what the parts of it are. The quantity was a
-- field they were made to fill in, and `amount` was always the truth anyway.
--
-- An item keeps its label and its amount, and a heading still equals the items
-- under it. Only the arithmetic nobody was doing goes.

ALTER TABLE "event_costing_lines"
  DROP CONSTRAINT IF EXISTS "costing_items_are_counted",
  DROP CONSTRAINT IF EXISTS "costing_headings_are_not_counted",
  DROP CONSTRAINT IF EXISTS "costing_line_quantity_is_whole",
  DROP CONSTRAINT IF EXISTS "costing_line_quantity_is_positive";

/*
 * No backfill. `amount` on every item already holds quantity times unit price —
 * the service computed it on the way in and wrote it — so dropping the two
 * columns loses the working, not the figure.
 */
ALTER TABLE "event_costing_lines"
  DROP COLUMN "quantity",
  DROP COLUMN "unit_amount";
