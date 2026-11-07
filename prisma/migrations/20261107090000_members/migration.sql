-- members
-- Hand-written SQL: constraints, indexes, triggers and data fixes that
-- the Prisma schema language cannot express. Prisma will apply this in order
-- and will not diff its contents.
--
-- The register once called `sponsors` is the temple's member register, and
-- "sponsor" now means only someone funding a pooja. So:
--
--   * The register and everything named after it becomes `members`.
--   * Every membership number moves to one series, M-. Existing numbers keep
--     their digits (S-012 becomes M-012), so a receipt printed with the old
--     number still points at the same member. The permanence guard is lifted
--     only for this renumbering.
--   * Sanththa is required of pooja sponsors and optional for other members,
--     so any member may pay it. The trigger refusing payments from members who
--     do not subscribe goes; `subscribes` now records an opt-in and defaults to
--     off for new members.
--   * The `devotee` role goes. Being a member is read from the register, never
--     stored as a role, so it cannot disagree with it; vendor and staff remain.

-- ── rename the register ─────────────────────────────────────────────────────

ALTER TABLE "sponsors" RENAME TO "members";
ALTER TABLE "members" RENAME COLUMN "sponsor_no" TO "member_no";
ALTER TABLE "members" RENAME COLUMN "sponsor_since" TO "member_since";
ALTER TABLE "members" RENAME CONSTRAINT "sponsors_pkey" TO "members_pkey";
ALTER TABLE "members" RENAME CONSTRAINT "sponsors_party_id_fkey" TO "members_party_id_fkey";
ALTER INDEX "sponsors_sponsor_no_key" RENAME TO "members_member_no_key";
ALTER INDEX "sponsors_active" RENAME TO "members_active";
ALTER TABLE "members" ALTER COLUMN "subscribes" SET DEFAULT false;

ALTER TABLE "sanththa_payments" RENAME COLUMN "sponsor_id" TO "member_id";
ALTER TABLE "sanththa_payments"
  RENAME CONSTRAINT "sanththa_payments_sponsor_id_fkey" TO "sanththa_payments_member_id_fkey";
ALTER INDEX "payments_sponsor" RENAME TO "payments_member";
ALTER INDEX "one_payment_per_sponsor_per_year" RENAME TO "one_payment_per_member_per_year";

ALTER SEQUENCE "sponsor_no_seq" RENAME TO "member_no_seq";

-- ── triggers follow the new names ───────────────────────────────────────────

DROP TRIGGER "sponsors_allocate_sponsor_no" ON "members";
DROP FUNCTION allocate_sponsor_no();

CREATE FUNCTION allocate_member_no() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.member_no IS DISTINCT FROM OLD.member_no THEN
    RAISE EXCEPTION 'member_no % is permanent - it is printed on receipts', OLD.member_no
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.member_no IS NULL OR btrim(NEW.member_no) = '' THEN
    NEW.member_no := 'M-' || lpad(nextval('member_no_seq')::text, 3, '0');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TRIGGER "sponsors_set_updated_at" ON "members" RENAME TO "members_set_updated_at";

DROP TRIGGER "sponsor_is_a_person" ON "members";
DROP FUNCTION assert_sponsor_is_a_person();

-- A member is a person the temple deals with, never an institution.
CREATE FUNCTION assert_member_is_a_person() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM parties WHERE id = NEW.party_id AND type = 'person') THEN
    RAISE EXCEPTION 'party % is not a person and cannot be a member', NEW.party_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "member_is_a_person"
  AFTER INSERT OR UPDATE OF "party_id" ON "members"
  FOR EACH ROW EXECUTE FUNCTION assert_member_is_a_person();

DROP TRIGGER "payer_subscribes" ON "sanththa_payments";
DROP FUNCTION assert_sponsor_subscribes();

-- ── one series of membership numbers ───────────────────────────────────────

UPDATE "members"
   SET "member_no" = regexp_replace("member_no", '^S-', 'M-')
 WHERE "member_no" LIKE 'S-%';

CREATE TRIGGER "members_allocate_member_no"
  BEFORE INSERT OR UPDATE OF "member_no" ON "members"
  FOR EACH ROW EXECUTE FUNCTION allocate_member_no();

-- ── membership is not a role ───────────────────────────────────────────────

DELETE FROM "party_roles" WHERE "kind" = 'devotee';

ALTER TYPE "party_kind" RENAME TO "party_kind_old";
CREATE TYPE "party_kind" AS ENUM ('vendor', 'staff');
ALTER TABLE "party_roles"
  ALTER COLUMN "kind" TYPE "party_kind" USING "kind"::text::"party_kind";
DROP TYPE "party_kind_old";
