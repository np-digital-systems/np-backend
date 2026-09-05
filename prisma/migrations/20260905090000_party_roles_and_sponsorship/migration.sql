-- ── party roles ─────────────────────────────────────────────────────────────
--
-- A party's kind was one column, so a person who both sponsors a pooja and
-- supplies the temple its flowers had to be filed twice. A party may now hold
-- several roles, which is what the label always meant.

CREATE TABLE "party_roles" (
  "party_id" integer    NOT NULL,
  "kind"     party_kind NOT NULL,

  CONSTRAINT "party_roles_pkey" PRIMARY KEY ("party_id", "kind"),
  CONSTRAINT "party_roles_party_id_fkey" FOREIGN KEY ("party_id")
    REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "party_roles_kind" ON "party_roles" ("kind");

INSERT INTO "party_roles" ("party_id", "kind")
SELECT "id", "kind" FROM "parties";

DROP INDEX IF EXISTS "parties_kind";
ALTER TABLE "parties" DROP COLUMN "kind";
CREATE INDEX "parties_active" ON "parties" ("is_active");

-- ── sponsorship moves from users to parties ─────────────────────────────────
--
-- The foreign keys pointed at users, so registering a sponsor meant creating a
-- login for someone who would never sign in — and the electricity board, which
-- can never have one, had nowhere to sit. Sponsorship is a dealing with a
-- party; whether that party can log in is a separate question.

-- Every user who sponsors anything needs a party to carry it.
INSERT INTO "parties" ("name_ta", "name_en", "user_id", "phone")
SELECT u."name_ta", u."full_name", u."id", u."phone"
  FROM "users" u
 WHERE u."id" IN (
         SELECT "sponsor_id" FROM "events" WHERE "sponsor_id" IS NOT NULL
         UNION
         SELECT "user_id" FROM "event_type_sponsors"
       )
   AND NOT EXISTS (SELECT 1 FROM "parties" p WHERE p."user_id" = u."id");

-- They are sponsors by demonstration, whatever else they may also be.
INSERT INTO "party_roles" ("party_id", "kind")
SELECT p."id", 'sponsor'
  FROM "parties" p
 WHERE p."user_id" IN (
         SELECT "sponsor_id" FROM "events" WHERE "sponsor_id" IS NOT NULL
         UNION
         SELECT "user_id" FROM "event_type_sponsors"
       )
ON CONFLICT DO NOTHING;

-- event_type_sponsors.user_id → party_id
ALTER TABLE "event_type_sponsors" ADD COLUMN "party_id" integer;

UPDATE "event_type_sponsors" s
   SET "party_id" = p."id"
  FROM "parties" p
 WHERE p."user_id" = s."user_id";

ALTER TABLE "event_type_sponsors" ALTER COLUMN "party_id" SET NOT NULL;

DROP INDEX IF EXISTS "one_sponsor_per_slot";
DROP INDEX IF EXISTS "sponsors_by_user";
ALTER TABLE "event_type_sponsors" DROP COLUMN "user_id";

ALTER TABLE "event_type_sponsors"
  ADD CONSTRAINT "event_type_sponsors_party_id_fkey" FOREIGN KEY ("party_id")
    REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "one_sponsor_per_slot"
  ON "event_type_sponsors" ("event_type_id", "instance_identifier", "party_id");
CREATE INDEX "sponsors_by_party" ON "event_type_sponsors" ("party_id");

-- events.sponsor_id → sponsor_party_id
ALTER TABLE "events" ADD COLUMN "sponsor_party_id" integer;

UPDATE "events" e
   SET "sponsor_party_id" = p."id"
  FROM "parties" p
 WHERE p."user_id" = e."sponsor_id";

DROP INDEX IF EXISTS "events_sponsor";
ALTER TABLE "events" DROP COLUMN "sponsor_id";

ALTER TABLE "events"
  ADD CONSTRAINT "events_sponsor_party_id_fkey" FOREIGN KEY ("sponsor_party_id")
    REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "events_sponsor" ON "events" ("sponsor_party_id");
