-- Constraints, indexes and triggers that the Prisma schema language cannot express.
-- Prisma owns tables, columns, enums, foreign keys and plain indexes; this file owns
-- everything below that line. See prisma/README.md before editing.

-- ── shared helpers ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- ── parties ─────────────────────────────────────────────────────────────────

ALTER TABLE "parties"
  ADD CONSTRAINT "name_not_blank" CHECK (btrim("name_ta") <> ''),
  ADD CONSTRAINT "organisations_have_no_person_fields" CHECK (
    "type" <> 'organisation' OR "name_en" IS NOT NULL OR "reference_no" IS NOT NULL
  );

CREATE INDEX "parties_name_search" ON "parties"
  USING gin (("name_ta" || ' ' || coalesce("name_en", '')) gin_trgm_ops);

CREATE TRIGGER "parties_set_updated_at"
  BEFORE UPDATE ON "parties"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── sponsors ────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS "sponsor_no_seq";

CREATE OR REPLACE FUNCTION allocate_sponsor_no() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.sponsor_no IS DISTINCT FROM OLD.sponsor_no THEN
    RAISE EXCEPTION 'sponsor_no % is permanent - it is printed on receipts', OLD.sponsor_no
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.sponsor_no IS NULL OR btrim(NEW.sponsor_no) = '' THEN
    NEW.sponsor_no := 'S-' || lpad(nextval('sponsor_no_seq')::text, 3, '0');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sponsors_allocate_sponsor_no"
  BEFORE INSERT OR UPDATE OF "sponsor_no" ON "sponsors"
  FOR EACH ROW EXECUTE FUNCTION allocate_sponsor_no();

CREATE TRIGGER "sponsors_set_updated_at"
  BEFORE UPDATE ON "sponsors"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A sponsor is a person the temple deals with, never an institution.
CREATE OR REPLACE FUNCTION assert_sponsor_is_a_person() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM parties WHERE id = NEW.party_id AND type = 'person') THEN
    RAISE EXCEPTION 'party % is not a person and cannot be a sponsor', NEW.party_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "sponsor_is_a_person"
  AFTER INSERT OR UPDATE OF "party_id" ON "sponsors"
  FOR EACH ROW EXECUTE FUNCTION assert_sponsor_is_a_person();

-- ── accounts (sign-in) ──────────────────────────────────────────────────────

ALTER TABLE "user_accounts"
  ADD CONSTRAINT "email_not_blank"    CHECK (btrim("email"::text) <> ''),
  ADD CONSTRAINT "password_not_blank" CHECK (btrim("password_hash") <> '');

CREATE INDEX "user_accounts_active_role" ON "user_accounts" ("role") WHERE "is_active";

CREATE TRIGGER "user_accounts_set_updated_at"
  BEFORE UPDATE ON "user_accounts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A sign-in belongs to a person, not to the electricity board.
CREATE OR REPLACE FUNCTION assert_account_is_a_person() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM parties WHERE id = NEW.party_id AND type = 'person') THEN
    RAISE EXCEPTION 'party % is not a person and cannot hold a sign-in', NEW.party_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "account_is_a_person"
  AFTER INSERT OR UPDATE OF "party_id" ON "user_accounts"
  FOR EACH ROW EXECUTE FUNCTION assert_account_is_a_person();

-- ── sessions ────────────────────────────────────────────────────────────────

ALTER TABLE "user_sessions"
  ADD CONSTRAINT "expires_after_creation" CHECK ("expires_at" > "created_at");

CREATE INDEX "user_sessions_live" ON "user_sessions" ("user_id") WHERE "revoked_at" IS NULL;

-- ── permissions ─────────────────────────────────────────────────────────────

ALTER TABLE "permissions"
  ADD CONSTRAINT "code_shape" CHECK ("code" ~ '^[a-z-]+:[a-z-]+$');

-- ── financial years ─────────────────────────────────────────────────────────

ALTER TABLE "financial_years"
  ADD CONSTRAINT "year_range"        CHECK ("ends_on" > "starts_on"),
  ADD CONSTRAINT "closed_is_stamped" CHECK (
    "status" <> 'closed'
    OR ("closed_on" IS NOT NULL AND "closed_by" IS NOT NULL
        AND "income" IS NOT NULL AND "expenses" IS NOT NULL)
  ),
  ADD CONSTRAINT "no_overlap" EXCLUDE USING gist (
    daterange("starts_on", "ends_on", '[]') WITH &&
  );

CREATE UNIQUE INDEX "one_current_year" ON "financial_years" ("is_current") WHERE "is_current";

-- ── chart of accounts ───────────────────────────────────────────────────────

ALTER TABLE "accounts"
  ADD CONSTRAINT "not_own_parent" CHECK ("parent_id" IS DISTINCT FROM "id"),
  ADD CONSTRAINT "income_expense_open_flat" CHECK (
    "type" NOT IN ('income', 'expense') OR "opening_balance" = 0
  );

CREATE INDEX "accounts_type" ON "accounts" ("type") WHERE "is_active";

-- ── projects ────────────────────────────────────────────────────────────────

ALTER TABLE "projects"
  ADD CONSTRAINT "target_after_start" CHECK ("target_date" IS NULL OR "target_date" >= "start_date"),
  ADD CONSTRAINT "budget_positive"    CHECK ("budget" IS NULL OR "budget" > 0);

-- ── activities ──────────────────────────────────────────────────────────────

-- A default head must suit the kind of entry it will be offered on, so only
-- income and expense heads may be a default at all.
CREATE OR REPLACE FUNCTION assert_default_account_is_codeable() RETURNS trigger AS $$
BEGIN
  IF NEW.default_account_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM accounts
     WHERE id = NEW.default_account_id
       AND type IN ('income', 'expense')
       AND is_postable
  ) THEN
    RAISE EXCEPTION 'account % is not a postable income or expense head', NEW.default_account_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "activity_default_account_is_codeable"
  AFTER INSERT OR UPDATE OF "default_account_id" ON "activities"
  FOR EACH ROW EXECUTE FUNCTION assert_default_account_is_codeable();

-- ── vouchers ────────────────────────────────────────────────────────────────

ALTER TABLE "vouchers"
  ADD CONSTRAINT "amount_positive"      CHECK ("amount" > 0),
  ADD CONSTRAINT "cash_has_no_bank"     CHECK (("mode" = 'cash') = ("bank_account_id" IS NULL)),
  ADD CONSTRAINT "cheque_has_number"    CHECK ("mode" <> 'cheque' OR "cheque_no" IS NOT NULL),
  ADD CONSTRAINT "rejection_has_reason" CHECK ("status" <> 'Rejected' OR "rejection_reason" IS NOT NULL),
  ADD CONSTRAINT "decided_is_stamped"   CHECK (("decided_by" IS NULL) = ("decided_at" IS NULL)),
  ADD CONSTRAINT "posted_was_approved"  CHECK ("posted_at" IS NULL OR "decided_at" IS NOT NULL),
  ADD CONSTRAINT "party_name_not_blank" CHECK (btrim("party") <> '');

CREATE INDEX "vouchers_pending" ON "vouchers" ("submitted_at") WHERE "status" = 'Pending Approval';

ALTER TABLE "voucher_lines"
  ADD CONSTRAINT "voucher_lines_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "voucher_sequences"
  ADD CONSTRAINT "next_no_positive" CHECK ("next_no" >= 1);

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

CREATE TRIGGER "vouchers_guard_posted"
  BEFORE UPDATE OR DELETE ON "vouchers"
  FOR EACH ROW EXECUTE FUNCTION guard_posted_voucher();

CREATE OR REPLACE FUNCTION guard_posted_voucher_line() RETURNS trigger AS $$
DECLARE
  parent_id     BIGINT;
  parent_status voucher_status;
  parent_ref    TEXT;
BEGIN
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

CREATE TRIGGER "voucher_lines_guard_posted"
  BEFORE INSERT OR UPDATE OR DELETE ON "voucher_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_posted_voucher_line();

-- ── ledger ──────────────────────────────────────────────────────────────────

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_one_side_only" CHECK (
    ("debit"  IS NOT NULL AND "credit" IS NULL AND "debit"  > 0) OR
    ("credit" IS NOT NULL AND "debit"  IS NULL AND "credit" > 0)
  );

CREATE OR REPLACE FUNCTION assert_voucher_balanced() RETURNS trigger AS $$
DECLARE
  debit_total  numeric(14,2);
  credit_total numeric(14,2);
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    INTO debit_total, credit_total
    FROM ledger_entries
   WHERE voucher_id = NEW.voucher_id;

  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'voucher % does not balance: debit %, credit %',
      NEW.voucher_id, debit_total, credit_total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ledger_balanced"
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_voucher_balanced();

CREATE TRIGGER "ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ── deposits & assets ───────────────────────────────────────────────────────

ALTER TABLE "fixed_deposits"
  ADD CONSTRAINT "matures_after_placement" CHECK ("matures_on" > "placed_on"),
  ADD CONSTRAINT "rate_sane"               CHECK ("interest_rate" > 0 AND "interest_rate" < 100),
  ADD CONSTRAINT "not_own_renewal"         CHECK ("renewed_from_id" IS DISTINCT FROM "id"),
  ADD CONSTRAINT "principal_positive"      CHECK ("principal" > 0);

ALTER TABLE "assets"
  ADD CONSTRAINT "disposal_is_consistent"  CHECK (("status" = 'disposed') = ("disposed_on" IS NOT NULL)),
  ADD CONSTRAINT "disposed_after_acquired" CHECK ("disposed_on" IS NULL OR "disposed_on" >= "acquired_on"),
  ADD CONSTRAINT "rate_range"              CHECK ("depreciation_rate" >= 0 AND "depreciation_rate" <= 100);

-- ── events ──────────────────────────────────────────────────────────────────

ALTER TABLE "event_types"
  ADD CONSTRAINT "instances_positive" CHECK ("no_of_instances" BETWEEN 1 AND 366);

ALTER TABLE "events"
  ADD CONSTRAINT "end_after_start" CHECK ("end_time" IS NULL OR "end_time" > "start_time");

-- Expression indexes cannot be written in the Prisma schema, so this lives in
-- SQL alone, as the posted-voucher triggers do.
CREATE UNIQUE INDEX "one_occurrence_per_slot_year"
  ON "events"("slot_id", (EXTRACT(YEAR FROM "scheduled_date")));

CREATE INDEX "events_pending" ON "events" ("scheduled_date") WHERE NOT "is_completed";

CREATE TRIGGER "event_types_set_updated_at"
  BEFORE UPDATE ON "event_types"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "events_set_updated_at"
  BEFORE UPDATE ON "events"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A general observance is paid for by collection, so it never carries a named
-- sponsor. Enforced here because the rule spans three tables.
CREATE OR REPLACE FUNCTION assert_sponsor_suits_funding() RETURNS trigger AS $$
DECLARE
  how event_funding;
BEGIN
  IF NEW.sponsor_party_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT et.funding INTO how
    FROM event_slots s
    JOIN event_types et ON et.id = s.event_type_id
   WHERE s.id = NEW.slot_id;

  IF how = 'general' THEN
    RAISE EXCEPTION 'this observance is funded by collection and takes no named sponsor'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "sponsor_suits_funding"
  AFTER INSERT OR UPDATE OF "sponsor_party_id", "slot_id" ON "events"
  FOR EACH ROW EXECUTE FUNCTION assert_sponsor_suits_funding();

CREATE OR REPLACE FUNCTION assert_type_takes_sponsors() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM event_types WHERE id = NEW.event_type_id AND funding = 'general') THEN
    RAISE EXCEPTION 'this observance is funded by collection and takes no registered sponsors'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "type_takes_sponsors"
  AFTER INSERT OR UPDATE OF "event_type_id" ON "event_type_sponsors"
  FOR EACH ROW EXECUTE FUNCTION assert_type_takes_sponsors();

-- ── sanththa ────────────────────────────────────────────────────────────────

ALTER TABLE "sanththa_rates"
  ADD CONSTRAINT "amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "year_sane"       CHECK ("year" BETWEEN 2000 AND 2100);

ALTER TABLE "sanththa_payments"
  ADD CONSTRAINT "mode_allowed"    CHECK ("mode" IN ('cash', 'bank', 'online')),
  ADD CONSTRAINT "amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "year_sane"       CHECK ("year" BETWEEN 2000 AND 2100);

-- The foreign key to `sponsors` already proves the payer is a sponsor, so what
-- is left to check is that they are one who actually subscribes.
CREATE OR REPLACE FUNCTION assert_sponsor_subscribes() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sponsors WHERE party_id = NEW.sponsor_id AND subscribes
  ) THEN
    RAISE EXCEPTION 'sponsor % is exempt from the annual sanththa', NEW.sponsor_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "payer_subscribes"
  AFTER INSERT OR UPDATE OF "sponsor_id" ON "sanththa_payments"
  FOR EACH ROW EXECUTE FUNCTION assert_sponsor_subscribes();

-- ── system ──────────────────────────────────────────────────────────────────

CREATE TRIGGER "audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

ALTER TABLE "notifications"
  ADD CONSTRAINT "action_is_complete" CHECK (("action_label" IS NULL) = ("action_href" IS NULL));

CREATE INDEX "notifications_unread" ON "notification_recipients" ("user_id") WHERE "read_at" IS NULL;

ALTER TABLE "settings"
  ADD CONSTRAINT "known_keys" CHECK ("key" IN ('temple', 'locale', 'accounting', 'notifications'));

CREATE TRIGGER "settings_set_updated_at"
  BEFORE UPDATE ON "settings"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
