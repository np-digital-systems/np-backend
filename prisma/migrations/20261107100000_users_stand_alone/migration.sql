-- users_stand_alone
-- Hand-written SQL: constraints, indexes, triggers and data fixes that
-- the Prisma schema language cannot express. Prisma will apply this in order
-- and will not diff its contents.
--
-- A sign-in is for running the portal; a party is someone the books deal with.
-- The two no longer meet: a sign-in carries its own name and phone, and the link
-- to a party goes. Parties that existed only to hold a sign-in are removed.

ALTER TABLE "user_accounts"
  ADD COLUMN "name_ta" TEXT,
  ADD COLUMN "name_en" TEXT,
  ADD COLUMN "phone" TEXT;

UPDATE "user_accounts" u
   SET "name_ta" = p."name_ta",
       "name_en" = p."name_en",
       "phone"   = p."phone"
  FROM "parties" p
 WHERE p."id" = u."party_id";

ALTER TABLE "user_accounts"
  ALTER COLUMN "name_ta" SET NOT NULL,
  ADD CONSTRAINT "account_name_not_blank" CHECK (btrim("name_ta") <> '');

CREATE TEMP TABLE "detached_parties" AS
  SELECT "party_id" AS "id" FROM "user_accounts";

DROP TRIGGER "account_is_a_person" ON "user_accounts";
DROP FUNCTION assert_account_is_a_person();

ALTER TABLE "user_accounts" DROP COLUMN "party_id";

-- Only parties nothing else refers to: no entries, roles, membership, sponsorships or defaults.
DELETE FROM "parties" p
 USING "detached_parties" d
 WHERE p."id" = d."id"
   AND NOT EXISTS (SELECT 1 FROM "vouchers" WHERE "party_id" = p."id")
   AND NOT EXISTS (SELECT 1 FROM "ledger_entries" WHERE "party_id" = p."id")
   AND NOT EXISTS (SELECT 1 FROM "party_roles" WHERE "party_id" = p."id")
   AND NOT EXISTS (SELECT 1 FROM "members" WHERE "party_id" = p."id")
   AND NOT EXISTS (SELECT 1 FROM "event_type_sponsors" WHERE "party_id" = p."id")
   AND NOT EXISTS (SELECT 1 FROM "events" WHERE "sponsor_party_id" = p."id")
   AND NOT EXISTS (SELECT 1 FROM "event_costing_lines" WHERE "party_id" = p."id")
   AND NOT EXISTS (SELECT 1 FROM "event_budget_lines" WHERE "party_id" = p."id")
   AND NOT EXISTS (SELECT 1 FROM "accounts" WHERE "default_party_id" = p."id")
   AND NOT EXISTS (SELECT 1 FROM "activities" WHERE "default_party_id" = p."id");

DROP TABLE "detached_parties";
