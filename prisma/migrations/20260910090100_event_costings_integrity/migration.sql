-- event_costings_integrity
-- Hand-written SQL: constraints, indexes, triggers and data fixes that
-- the Prisma schema language cannot express. Prisma will apply this in order
-- and will not diff its contents.

-- ── event_costings ──────────────────────────────────────────────────────────

ALTER TABLE "event_costings"
  ADD CONSTRAINT "costing_period_is_forwards" CHECK (
    "effective_to" IS NULL OR "effective_to" >= "effective_from"
  ),
  ADD CONSTRAINT "costing_sponsor_amount_is_not_negative" CHECK ("sponsor_amount" >= 0),
  -- A closed version is history. Leaving it `active` would let the resolver
  -- pick between two rows that both claim to be in force.
  ADD CONSTRAINT "closed_costings_are_superseded" CHECK (
    "effective_to" IS NULL OR "status" <> 'active'
  );

CREATE TRIGGER "event_costings_set_updated_at"
  BEFORE UPDATE ON "event_costings"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * One costing in force per scope at a time.
 *
 * The scope is the pair (type, slot), where a null slot is its own scope
 * covering the whole type — so a slot-specific version and a type-wide one may
 * overlap in time on purpose, and that overlap is exactly what resolution
 * exists to settle. Drafts are exempt: next year's revision has to be written
 * and argued over while the current one is still the one being quoted.
 */
ALTER TABLE "event_costings"
  ADD CONSTRAINT "one_costing_per_scope_at_a_time" EXCLUDE USING gist (
    "event_type_id" WITH =,
    (coalesce("slot_id", 0)) WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  ) WHERE ("status" <> 'draft');

-- A costing narrowed to a slot must be narrowed to a slot of its own type,
-- or resolution would hand Mahotsavam's தேர் day to a Friday pooja.
CREATE OR REPLACE FUNCTION assert_costing_slot_matches_type() RETURNS trigger AS $$
BEGIN
  IF NEW.slot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM event_slots
    WHERE id = NEW.slot_id AND event_type_id = NEW.event_type_id
  ) THEN
    RAISE EXCEPTION 'slot % does not belong to event type %', NEW.slot_id, NEW.event_type_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "costing_slot_matches_type"
  AFTER INSERT OR UPDATE OF "slot_id", "event_type_id" ON "event_costings"
  FOR EACH ROW EXECUTE FUNCTION assert_costing_slot_matches_type();

-- The sponsor's receipt has to name a head a receipt may actually be posted to.
CREATE OR REPLACE FUNCTION assert_costing_income_head() RETURNS trigger AS $$
DECLARE
  head accounts%ROWTYPE;
BEGIN
  SELECT * INTO head FROM accounts WHERE id = NEW.income_account_id;

  IF head.type <> 'income' THEN
    RAISE EXCEPTION 'account % is %, and a sponsor receipt must name an income head',
      head.code, head.type USING ERRCODE = 'check_violation';
  END IF;

  IF NOT head.is_postable THEN
    RAISE EXCEPTION 'account % is a grouping head and nothing can be posted to it', head.code
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "costing_income_head_is_postable_income"
  AFTER INSERT OR UPDATE OF "income_account_id" ON "event_costings"
  FOR EACH ROW EXECUTE FUNCTION assert_costing_income_head();

-- ── event_costing_lines ─────────────────────────────────────────────────────

ALTER TABLE "event_costing_lines"
  ADD CONSTRAINT "costing_line_amount_is_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "costing_line_no_is_positive" CHECK ("line_no" > 0),
  -- A heading is named by its account; an item under it has nothing else to
  -- go by, so it must carry its own words.
  ADD CONSTRAINT "costing_items_are_named" CHECK (
    "parent_line_id" IS NULL OR (label IS NOT NULL AND btrim(label) <> '')
  ),
  ADD CONSTRAINT "costing_line_label_not_blank" CHECK (
    "label" IS NULL OR btrim("label") <> ''
  ),
  -- Ten coconuts, or coconuts at 120 each, says nothing on its own.
  ADD CONSTRAINT "costing_line_quantity_is_whole" CHECK (
    ("quantity" IS NULL) = ("unit_amount" IS NULL)
  ),
  ADD CONSTRAINT "costing_line_quantity_is_positive" CHECK (
    "quantity" IS NULL OR ("quantity" > 0 AND "unit_amount" > 0)
  ),
  ADD CONSTRAINT "costing_line_is_not_its_own_parent" CHECK ("parent_line_id" <> "id");

/*
 * A heading equals the items under it.
 *
 * Deferred, so a service may rewrite a whole costing inside one transaction —
 * insert the heading, then its items — and be judged only on what it leaves
 * behind. Checked per costing rather than per row because deleting an item
 * changes a total the deleted row is no longer there to point at.
 */
CREATE OR REPLACE FUNCTION assert_costing_parent_totals() RETURNS trigger AS $$
DECLARE
  offending RECORD;
BEGIN
  SELECT p.line_no, p.amount AS heading, sum(c.amount) AS items
    INTO offending
    FROM event_costing_lines p
    JOIN event_costing_lines c ON c.parent_line_id = p.id
   WHERE p.costing_id = coalesce(NEW.costing_id, OLD.costing_id)
   GROUP BY p.id, p.line_no, p.amount
  HAVING p.amount <> sum(c.amount)
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'line % is %, but the items under it come to %',
      offending.line_no, offending.heading, offending.items
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "costing_parent_totals"
  AFTER INSERT OR UPDATE OR DELETE ON "event_costing_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_costing_parent_totals();

/*
 * An item sits under its heading in every sense.
 *
 * The account is carried down rather than looked up, so that reports never walk
 * the tree; this is what keeps the copy honest. One level only — an item cannot
 * itself be a heading, because a quote nested three deep is a quote nobody reads.
 */
CREATE OR REPLACE FUNCTION assert_costing_line_under_parent() RETURNS trigger AS $$
DECLARE
  parent event_costing_lines%ROWTYPE;
BEGIN
  IF NEW.parent_line_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO parent FROM event_costing_lines WHERE id = NEW.parent_line_id;

  IF parent.costing_id <> NEW.costing_id THEN
    RAISE EXCEPTION 'line % belongs to another costing than the heading it names', NEW.line_no
      USING ERRCODE = 'check_violation';
  END IF;

  IF parent.parent_line_id IS NOT NULL THEN
    RAISE EXCEPTION 'a costing goes one level deep; line % names an item as its heading', NEW.line_no
      USING ERRCODE = 'check_violation';
  END IF;

  IF parent.account_id <> NEW.account_id OR parent.fund_id <> NEW.fund_id THEN
    RAISE EXCEPTION 'line % must sit on the same head and fund as the heading above it', NEW.line_no
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "costing_line_under_parent"
  AFTER INSERT OR UPDATE OF "parent_line_id", "account_id", "fund_id", "costing_id"
  ON "event_costing_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_costing_line_under_parent();

-- What the temple expects to pay is an expense, and one that can be posted to.
CREATE OR REPLACE FUNCTION assert_costing_line_head() RETURNS trigger AS $$
DECLARE
  head accounts%ROWTYPE;
BEGIN
  SELECT * INTO head FROM accounts WHERE id = NEW.account_id;

  IF head.type <> 'expense' THEN
    RAISE EXCEPTION 'account % is %, and a costing line must name an expense head',
      head.code, head.type USING ERRCODE = 'check_violation';
  END IF;

  IF NOT head.is_postable THEN
    RAISE EXCEPTION 'account % is a grouping head and nothing can be posted to it', head.code
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "costing_line_head_is_postable_expense"
  AFTER INSERT OR UPDATE OF "account_id" ON "event_costing_lines"
  FOR EACH ROW EXECUTE FUNCTION assert_costing_line_head();

-- ── event_budget_lines ──────────────────────────────────────────────────────

ALTER TABLE "event_budget_lines"
  ADD CONSTRAINT "budget_line_amount_is_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "budget_line_no_is_positive" CHECK ("line_no" > 0),
  ADD CONSTRAINT "budget_line_label_not_blank" CHECK (btrim("label") <> '');

/*
 * A frozen budget stays frozen once the day has been kept.
 *
 * Until then it may be corrected — a cost nobody had thought of is found a week
 * before the festival, and the budget should be able to say so. Afterwards the
 * difference between plan and outturn is the report's whole subject, and a
 * budget edited to match the vouchers would report every event as exact.
 */
CREATE OR REPLACE FUNCTION reject_budget_change_after_the_day() RETURNS trigger AS $$
DECLARE
  kept BOOLEAN;
  ref INTEGER := coalesce(NEW.event_id, OLD.event_id);
BEGIN
  SELECT is_completed INTO kept FROM events WHERE id = ref;

  IF kept THEN
    RAISE EXCEPTION 'event % is marked complete; its budget is what it was quoted at', ref
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "budget_lines_frozen_after_the_day"
  AFTER INSERT OR UPDATE OR DELETE ON "event_budget_lines"
  FOR EACH ROW EXECUTE FUNCTION reject_budget_change_after_the_day();

ALTER TABLE "events"
  ADD CONSTRAINT "event_sponsor_amount_is_not_negative" CHECK (
    "sponsor_amount" IS NULL OR "sponsor_amount" >= 0
  );
