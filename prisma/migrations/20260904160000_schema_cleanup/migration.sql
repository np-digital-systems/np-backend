-- Schema cleanup: remove what nothing reads, move what sits in the wrong
-- place, and hold in the database the rules that were only ever conventions.

-- ------------------------------- the pooja link moves onto the line it is for

-- A split receipt of Rs 5,000 with Rs 2,000 earmarked for annadhanam is for
-- that pooja on one line and not on the other. Held on the header, "how much
-- did this pooja bring in" would answer 5,000 when the truth is 3,000.
ALTER TABLE "voucher_lines" ADD COLUMN "event_id" INTEGER;

ALTER TABLE "voucher_lines"
  ADD CONSTRAINT "voucher_lines_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "voucher_lines_event" ON "voucher_lines"("event_id");

-- Existing vouchers were single-line, so their occurrence belongs to line 1.
UPDATE "voucher_lines" l
SET "event_id" = v."event_id"
FROM "vouchers" v
WHERE v."id" = l."voucher_id" AND v."event_id" IS NOT NULL AND l."line_no" = 1;

-- --------------------------------------------------------- columns nothing reads

-- event_type_id: an occurrence already knows its own type, and the activity
--   carries what the entry is reported under. Never read anywhere.
-- event_ref: a text copy of "<pooja> — <occurrence>", which the description
--   already holds. Two columns, one fact, and nothing keeping them in step.
ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_event_type_id_fkey";
ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_event_id_fkey";

ALTER TABLE "vouchers"
  DROP COLUMN "event_type_id",
  DROP COLUMN "event_ref",
  DROP COLUMN "event_id";

-- activities.parent_id: a rollup no report ever performed. Speculative
--   structure earns its place when something reads it, not before.
ALTER TABLE "activities" DROP CONSTRAINT IF EXISTS "activities_parent_id_fkey";
DROP INDEX IF EXISTS "activities_parent";
ALTER TABLE "activities" DROP COLUMN "parent_id";

-- Free text the API accepted and no screen could ever show back.
ALTER TABLE "voucher_lines" DROP COLUMN "note";
ALTER TABLE "parties" DROP COLUMN "notes";

-- ------------------------------------------------- rules the database now holds

-- A ledger entry carries money in exactly one direction. Enforced here rather
-- than trusted from the posting code, because a row that broke it would put
-- the trial balance out with nothing to point at.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_one_side_only" CHECK (
    ("debit" IS NOT NULL AND "credit" IS NULL AND "debit" > 0) OR
    ("credit" IS NOT NULL AND "debit" IS NULL AND "credit" > 0)
  );

-- A voucher's stored total is the sum of its lines. It is stored so a register
-- of thousands need not aggregate to list them, which makes it a cached figure
-- — and a cached figure that can drift is worse than no cache at all.
CREATE OR REPLACE FUNCTION assert_voucher_total() RETURNS trigger AS $$
DECLARE
  line_total NUMERIC(14,2);
  header     RECORD;
BEGIN
  SELECT v.id, v.ref, v.amount INTO header
  FROM vouchers v
  WHERE v.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.voucher_id ELSE NEW.voucher_id END;

  -- The header may already be gone when a voucher is deleted outright.
  IF header IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO line_total
  FROM voucher_lines WHERE voucher_id = header.id;

  IF line_total <> header.amount THEN
    RAISE EXCEPTION 'voucher % totals % but its lines come to %',
      header.ref, header.amount, line_total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

-- Deferred to the end of the transaction: the lines are written one at a time
-- and the total only has to agree once they all are.
CREATE CONSTRAINT TRIGGER voucher_lines_total_agrees
  AFTER INSERT OR UPDATE OR DELETE ON voucher_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_voucher_total();

-- ---------------------------------------------------- indexes the joins wanted

-- Every foreign key on a table that grows. Without these, deleting or joining
-- from the parent scans the child end to end.
-- The trigram index on the typed name already held this name; it is renamed
-- to say which of the two party columns it covers.
ALTER INDEX "vouchers_party" RENAME TO "vouchers_party_text";
CREATE INDEX "vouchers_party" ON "vouchers"("party_id");
CREATE INDEX "vouchers_bank_account" ON "vouchers"("bank_account_id");
CREATE INDEX "vouchers_created_by" ON "vouchers"("created_by");
CREATE INDEX "ledger_entries_project" ON "ledger_entries"("project_id");
CREATE INDEX "ledger_entries_bank_account" ON "ledger_entries"("bank_account_id");
CREATE INDEX "voucher_lines_project" ON "voucher_lines"("project_id");
CREATE INDEX "activities_default_fund" ON "activities"("default_fund_id");
CREATE INDEX "accounts_default_party" ON "accounts"("default_party_id");
CREATE INDEX "fixed_deposits_fund" ON "fixed_deposits"("fund_id");
CREATE INDEX "assets_fund" ON "assets"("fund_id");
