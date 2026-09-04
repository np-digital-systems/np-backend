-- Multi-line vouchers.
--
-- A receipt for Rs 5,000 of which Rs 2,000 is earmarked for annadhanam becomes
-- one document with two lines, where before it could only be two vouchers
-- pretending to be unrelated. The coding moves to the lines; the header keeps
-- what belongs to the document — its reference, date, payer and total.

CREATE TABLE "voucher_lines" (
  "id"          BIGSERIAL PRIMARY KEY,
  "voucher_id"  BIGINT NOT NULL,
  "line_no"     SMALLINT NOT NULL,
  "account_id"  INTEGER NOT NULL,
  "amount"      DECIMAL(14,2) NOT NULL,
  "fund_id"     INTEGER NOT NULL,
  "project_id"  INTEGER,
  "activity_id" INTEGER,
  "note"        TEXT
);

ALTER TABLE "voucher_lines"
  ADD CONSTRAINT "voucher_lines_voucher_id_fkey"
    FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "voucher_lines_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "voucher_lines_fund_id_fkey"
    FOREIGN KEY ("fund_id") REFERENCES "funds"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "voucher_lines_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "voucher_lines_activity_id_fkey"
    FOREIGN KEY ("activity_id") REFERENCES "activities"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- A line carries money in one direction only; nil or negative is not an entry.
ALTER TABLE "voucher_lines"
  ADD CONSTRAINT "voucher_lines_amount_positive" CHECK ("amount" > 0);

CREATE UNIQUE INDEX "voucher_line_no" ON "voucher_lines"("voucher_id", "line_no");
CREATE INDEX "voucher_lines_account" ON "voucher_lines"("account_id");
CREATE INDEX "voucher_lines_activity" ON "voucher_lines"("activity_id");
CREATE INDEX "voucher_lines_fund" ON "voucher_lines"("fund_id");

-- ------------------------------------------------------------------ backfill

-- Every voucher that exists is a one-line voucher; its coding becomes line 1.
-- Done before the columns are dropped, so nothing is lost in the move.
INSERT INTO "voucher_lines"
  ("voucher_id", "line_no", "account_id", "amount", "fund_id", "project_id", "activity_id")
SELECT v."id", 1, v."account_id", v."amount", v."fund_id", v."project_id", v."activity_id"
FROM "vouchers" v;

-- ------------------------------------------------- the header sheds its coding

ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_account_id_fkey";
ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_fund_id_fkey";
ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_project_id_fkey";
ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_activity_id_fkey";

ALTER TABLE "vouchers"
  DROP COLUMN "account_id",
  DROP COLUMN "fund_id",
  DROP COLUMN "project_id",
  DROP COLUMN "activity_id";

-- ------------------------------------------------ the posted-voucher guard

-- The guard checked coding columns that now live on the lines. Without this it
-- would fail on every update of a voucher, posted or not, because the fields
-- it names no longer exist on the row.
CREATE OR REPLACE FUNCTION guard_posted_voucher() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Posted' THEN
      RAISE EXCEPTION 'voucher % is posted and cannot be deleted', OLD.ref
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'Posted' AND (
       NEW.ref               IS DISTINCT FROM OLD.ref
    OR NEW.kind              IS DISTINCT FROM OLD.kind
    OR NEW.financial_year_id IS DISTINCT FROM OLD.financial_year_id
    OR NEW.date              IS DISTINCT FROM OLD.date
    OR NEW.amount            IS DISTINCT FROM OLD.amount
    OR NEW.mode              IS DISTINCT FROM OLD.mode
    OR NEW.bank_account_id   IS DISTINCT FROM OLD.bank_account_id
  ) THEN
    RAISE EXCEPTION 'voucher % is posted; reverse it instead of editing it', OLD.ref
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The coding moved to the lines, so the protection has to move with it.
-- Otherwise a posted voucher's header would be frozen while the heads it posts
-- against could still be rewritten underneath the ledger.
CREATE OR REPLACE FUNCTION guard_posted_voucher_line() RETURNS trigger AS $$
DECLARE
  parent_id     BIGINT;
  parent_status voucher_status;
  parent_ref    TEXT;
BEGIN
  -- NEW is unassigned on DELETE and OLD on INSERT, so each is read only where
  -- it exists rather than coalesced across the two.
  IF TG_OP = 'DELETE' THEN
    parent_id := OLD.voucher_id;
  ELSE
    parent_id := NEW.voucher_id;
  END IF;

  SELECT v.status, v.ref INTO parent_status, parent_ref
  FROM vouchers v WHERE v.id = parent_id;

  IF parent_status = 'Posted' THEN
    RAISE EXCEPTION 'voucher % is posted; its lines cannot be changed', parent_ref
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER voucher_lines_guard_posted
  BEFORE INSERT OR UPDATE OR DELETE ON voucher_lines
  FOR EACH ROW EXECUTE FUNCTION guard_posted_voucher_line();
