-- costings_follow_the_activity
-- Hand-written SQL: constraints, indexes, triggers and data fixes that
-- the Prisma schema language cannot express. Prisma will apply this in order
-- and will not diff its contents.
--
-- Three changes the temple asked for, in one migration because they touch the
-- same columns:
--
--   * The income head and fund leave the costing. They were already answered
--     on the pooja type's activity, and a fact stored twice is a fact that
--     eventually disagrees with itself.
--   * `status` goes. There is no draft and no act of putting a costing into
--     force: a saved costing applies until it is edited, and an edit applies
--     from the day it is made. Revising a costing that has been quoted from
--     closes it and opens its successor, which is what keeps the history a
--     year-by-year report is read from.
--   * An item now carries a quantity and a unit price, because that is how the
--     temple buys — ten coconuts at 120 — and the amount follows from them.

-- ── drop what depends on the columns going ──────────────────────────────────

DROP TRIGGER IF EXISTS "costing_income_head_is_postable_income" ON "event_costings";
DROP FUNCTION IF EXISTS assert_costing_income_head();

ALTER TABLE "event_costings"
  DROP CONSTRAINT IF EXISTS "closed_costings_are_superseded",
  DROP CONSTRAINT IF EXISTS "one_costing_per_scope_at_a_time";

-- ── the columns themselves ──────────────────────────────────────────────────

ALTER TABLE "event_costings"
  DROP COLUMN "income_account_id",
  DROP COLUMN "income_fund_id",
  DROP COLUMN "status";

DROP TYPE "costing_status";

DROP INDEX IF EXISTS "costings_status";
DROP INDEX IF EXISTS "costings_income_account";
DROP INDEX IF EXISTS "costings_income_fund";

-- ── one costing in force per scope, with no exemption ───────────────────────

/*
 * The same rule as before, minus the drafts it used to let through.
 *
 * The scope is the pair (type, slot), a null slot being its own scope covering
 * the whole type — so a slot's own version and the type-wide one overlap in
 * time on purpose, and that overlap is what resolution exists to settle. What
 * may not overlap is two versions of the same scope, because then no date
 * could say which figure it was quoted at.
 */
ALTER TABLE "event_costings"
  ADD CONSTRAINT "one_costing_per_scope_at_a_time" EXCLUDE USING gist (
    "event_type_id" WITH =,
    (coalesce("slot_id", 0)) WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  );

-- ── an item is a quantity at a price ────────────────────────────────────────

ALTER TABLE "event_costing_lines"
  DROP CONSTRAINT IF EXISTS "costing_line_quantity_is_whole",
  DROP CONSTRAINT IF EXISTS "costing_line_quantity_is_positive";

ALTER TABLE "event_costing_lines"
  -- Ten coconuts at 120. An item without both halves is a figure nobody can
  -- check against a shop bill, which is the only reason to itemise at all.
  ADD CONSTRAINT "costing_items_are_counted" CHECK (
    "parent_line_id" IS NULL
    OR ("quantity" IS NOT NULL AND "unit_amount" IS NOT NULL)
  ),
  -- A heading is the sum of its items, never a count of anything itself.
  ADD CONSTRAINT "costing_headings_are_not_counted" CHECK (
    "parent_line_id" IS NOT NULL
    OR ("quantity" IS NULL AND "unit_amount" IS NULL)
  ),
  ADD CONSTRAINT "costing_line_quantity_is_positive" CHECK (
    "quantity" IS NULL OR ("quantity" > 0 AND "unit_amount" > 0)
  ),
  /*
   * The amount follows the quantity.
   *
   * Kept as a column rather than computed on read because it is what the
   * heading above is checked against and what the ledger eventually carries;
   * the tolerance is a rounding allowance, not a licence to disagree.
   */
  ADD CONSTRAINT "costing_item_amount_follows_quantity" CHECK (
    "quantity" IS NULL
    OR abs("amount" - round("quantity" * "unit_amount", 2)) < 0.01
  );
