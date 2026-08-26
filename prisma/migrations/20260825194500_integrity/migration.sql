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

-- ── users & the sanththa register ───────────────────────────────────────────

ALTER TABLE "users"
  ADD CONSTRAINT "staff_need_email"       CHECK ("role" = 'user' OR "email" IS NOT NULL),
  ADD CONSTRAINT "staff_need_password"    CHECK ("role" = 'user' OR "password_hash" IS NOT NULL),
  ADD CONSTRAINT "register_is_whole"      CHECK (("member_no" IS NULL) = ("joined_on" IS NULL)),
  ADD CONSTRAINT "only_members_subscribe" CHECK ("member_no" IS NOT NULL OR NOT "subscribes");

CREATE INDEX "users_active_role" ON "users" ("role") WHERE "is_active";
CREATE INDEX "users_register"    ON "users" ("member_no") WHERE "subscribes";
CREATE INDEX "users_name_search" ON "users"
  USING gin (("name_ta" || ' ' || coalesce("full_name", '')) gin_trgm_ops);

CREATE SEQUENCE "sanththa_member_no_seq";

CREATE OR REPLACE FUNCTION allocate_member_no() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.member_no IS NOT NULL
     AND NEW.member_no IS DISTINCT FROM OLD.member_no THEN
    RAISE EXCEPTION 'member_no % is permanent - it is printed on receipts', OLD.member_no
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.joined_on IS NOT NULL AND NEW.member_no IS NULL THEN
    NEW.member_no := 'S-' || lpad(nextval('sanththa_member_no_seq')::text, 3, '0');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_allocate_member_no"
  BEFORE INSERT OR UPDATE OF "joined_on", "member_no" ON "users"
  FOR EACH ROW EXECUTE FUNCTION allocate_member_no();

CREATE TRIGGER "users_set_updated_at"
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── sessions ────────────────────────────────────────────────────────────────

ALTER TABLE "user_sessions"
  ADD CONSTRAINT "expires_after_creation" CHECK ("expires_at" > "created_at");

CREATE INDEX "user_sessions_live" ON "user_sessions" ("user_id") WHERE "revoked_at" IS NULL;

-- ── permissions ─────────────────────────────────────────────────────────────

ALTER TABLE "permissions"
  ADD CONSTRAINT "code_shape" CHECK ("code" ~ '^[a-z-]+:[a-z-]+$');

-- ── financial years ─────────────────────────────────────────────────────────

ALTER TABLE "financial_years"
  ADD CONSTRAINT "year_range"       CHECK ("ends_on" > "starts_on"),
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

-- ── vouchers ────────────────────────────────────────────────────────────────

ALTER TABLE "vouchers"
  ADD CONSTRAINT "amount_positive"      CHECK ("amount" > 0),
  ADD CONSTRAINT "cash_has_no_bank"     CHECK (("mode" = 'cash') = ("bank_account_id" IS NULL)),
  ADD CONSTRAINT "cheque_has_number"    CHECK ("mode" <> 'cheque' OR "cheque_no" IS NOT NULL),
  ADD CONSTRAINT "rejection_has_reason" CHECK ("status" <> 'Rejected' OR "rejection_reason" IS NOT NULL),
  ADD CONSTRAINT "decided_is_stamped"   CHECK (("decided_by" IS NULL) = ("decided_at" IS NULL)),
  ADD CONSTRAINT "posted_was_approved"  CHECK ("posted_at" IS NULL OR "decided_at" IS NOT NULL);

CREATE INDEX "vouchers_pending" ON "vouchers" ("submitted_at") WHERE "status" = 'Pending Approval';

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
    OR NEW.account_id        IS DISTINCT FROM OLD.account_id
    OR NEW.fund_id           IS DISTINCT FROM OLD.fund_id
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

-- ── ledger ──────────────────────────────────────────────────────────────────

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "one_side_only"  CHECK (("debit" IS NULL) <> ("credit" IS NULL)),
  ADD CONSTRAINT "side_positive"  CHECK (coalesce("debit", "credit") > 0);

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

CREATE UNIQUE INDEX "one_occurrence_per_slot_per_year" ON "events"
  ("event_type_id", "instance_identifier", (extract(year from "scheduled_date")));

CREATE INDEX "events_pending" ON "events" ("scheduled_date") WHERE NOT "is_completed";

CREATE TRIGGER "event_types_set_updated_at"
  BEFORE UPDATE ON "event_types"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "events_set_updated_at"
  BEFORE UPDATE ON "events"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── sanththa payments ───────────────────────────────────────────────────────

ALTER TABLE "sanththa_payments"
  ADD CONSTRAINT "mode_allowed"     CHECK ("mode" IN ('cash', 'bank', 'online')),
  ADD CONSTRAINT "amount_positive"  CHECK ("amount" > 0),
  ADD CONSTRAINT "year_sane"        CHECK ("year" BETWEEN 2000 AND 2100);

CREATE OR REPLACE FUNCTION assert_user_is_member() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.user_id AND member_no IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'user % is not on the sanththa register', NEW.user_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "payer_is_on_the_register"
  AFTER INSERT OR UPDATE OF "user_id" ON "sanththa_payments"
  FOR EACH ROW EXECUTE FUNCTION assert_user_is_member();

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
