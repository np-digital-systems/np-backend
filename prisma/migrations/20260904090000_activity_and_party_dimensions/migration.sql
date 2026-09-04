-- Two analytical dimensions: what an entry was for, and who it was with.
--
-- Both replace domain columns that had been growing on the voucher itself.
-- An activity or a party is a row somebody adds; neither needs a migration
-- when the temple starts doing something new.

CREATE TYPE "activity_kind" AS ENUM ('pooja', 'service', 'facility', 'general');
CREATE TYPE "party_kind" AS ENUM ('sponsor', 'staff', 'vendor', 'devotee');

-- ---------------------------------------------------------------- activities

CREATE TABLE "activities" (
  "id"              SERIAL PRIMARY KEY,
  "name_ta"         TEXT NOT NULL,
  "name_en"         TEXT,
  "kind"            "activity_kind" NOT NULL DEFAULT 'general',
  "default_fund_id" INTEGER,
  "parent_id"       INTEGER,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "activities_name_ta_key" ON "activities"("name_ta");
CREATE INDEX "activities_kind" ON "activities"("kind", "is_active");
CREATE INDEX "activities_parent" ON "activities"("parent_id");

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_default_fund_id_fkey"
  FOREIGN KEY ("default_fund_id") REFERENCES "funds"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "activities_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "activities"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------------------------------------- parties

CREATE TABLE "parties" (
  "id"         SERIAL PRIMARY KEY,
  "name_ta"    TEXT NOT NULL,
  "name_en"    TEXT,
  "kind"       "party_kind" NOT NULL DEFAULT 'devotee',
  "user_id"    UUID,
  "phone"      TEXT,
  "notes"      TEXT,
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "parties_user_id_key" ON "parties"("user_id");
CREATE INDEX "parties_kind" ON "parties"("kind", "is_active");

-- Same trigram search the voucher party text already uses, so the picker can
-- match on any part of a name rather than only its opening letters.
CREATE INDEX "parties_name" ON "parties" USING GIN ("name_ta" gin_trgm_ops);

ALTER TABLE "parties"
  ADD CONSTRAINT "parties_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------------------- dimensions on the entries

ALTER TABLE "vouchers"
  ADD COLUMN "activity_id" INTEGER,
  ADD COLUMN "party_id"    INTEGER;

ALTER TABLE "ledger_entries"
  ADD COLUMN "activity_id" INTEGER,
  ADD COLUMN "party_id"    INTEGER;

-- RESTRICT, not SET NULL: an activity or party named by a posted entry is
-- part of the record and must be deactivated rather than removed.
ALTER TABLE "vouchers"
  ADD CONSTRAINT "vouchers_activity_id_fkey"
  FOREIGN KEY ("activity_id") REFERENCES "activities"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vouchers_party_id_fkey"
  FOREIGN KEY ("party_id") REFERENCES "parties"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_activity_id_fkey"
  FOREIGN KEY ("activity_id") REFERENCES "activities"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ledger_entries_party_id_fkey"
  FOREIGN KEY ("party_id") REFERENCES "parties"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ledger_activity_date" ON "ledger_entries"("activity_id", "date");
CREATE INDEX "ledger_party_date" ON "ledger_entries"("party_id", "date");

-- --------------------------------------------------------- defaults that save typing

-- A kurukkal honorarium is always paid to the same person.
ALTER TABLE "accounts" ADD COLUMN "default_party_id" INTEGER;

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_default_party_id_fkey"
  FOREIGN KEY ("default_party_id") REFERENCES "parties"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- A pooja type names its activity; the activity carries the fund in turn.
ALTER TABLE "event_types" ADD COLUMN "activity_id" INTEGER;

ALTER TABLE "event_types"
  ADD CONSTRAINT "event_types_activity_id_fkey"
  FOREIGN KEY ("activity_id") REFERENCES "activities"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "event_types_activity" ON "event_types"("activity_id");

-- ------------------------------------------------------------------ backfill

-- Every pooja type already on the calendar becomes an activity, so existing
-- receipts have somewhere to be coded from the day this ships.
INSERT INTO "activities" ("name_ta", "name_en", "kind")
SELECT "name_ta", "name_en", 'pooja'::"activity_kind"
FROM "event_types"
ON CONFLICT ("name_ta") DO NOTHING;

UPDATE "event_types" t
SET "activity_id" = a."id"
FROM "activities" a
WHERE a."name_ta" = t."name_ta" AND t."activity_id" IS NULL;

-- Sponsors on the calendar become parties, matched back by user, so a receipt
-- raised for a pooja can name a real party rather than a typed string.
INSERT INTO "parties" ("name_ta", "name_en", "kind", "user_id")
SELECT DISTINCT u."name_ta", u."full_name", 'sponsor'::"party_kind", u."id"
FROM "users" u
WHERE EXISTS (SELECT 1 FROM "events" e WHERE e."sponsor_id" = u."id")
   OR EXISTS (SELECT 1 FROM "event_type_sponsors" s WHERE s."user_id" = u."id")
ON CONFLICT ("user_id") DO NOTHING;
