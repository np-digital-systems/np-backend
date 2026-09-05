-- The activity carries the coding a line takes.
--
-- Fund, project and party are answered once when the activity is set up, not
-- on every voucher. Picking "Chef salary" then settles Annadhanam Fund and the
-- Night Dinner project by itself, and a clerk is left with the one question
-- that actually varies: what was this for, and how much.

ALTER TABLE "activities"
  ADD COLUMN IF NOT EXISTS "default_project_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "default_party_id"   INTEGER;

-- SET NULL rather than RESTRICT: a finished project or a retired party should
-- not hold an activity hostage. The activity simply stops suggesting it.
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_default_project_id_fkey"
  FOREIGN KEY ("default_project_id") REFERENCES "projects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "activities_default_party_id_fkey"
  FOREIGN KEY ("default_party_id") REFERENCES "parties"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "activities_default_project" ON "activities"("default_project_id");
CREATE INDEX IF NOT EXISTS "activities_default_party" ON "activities"("default_party_id");

-- The party moves off the ledger head, which was too coarse to be right:
-- `5200 Salaries` serves the kurukkal, the melam group and the chef alike,
-- while an activity is only ever one of them. Nothing is carried across —
-- the column was added days ago and never filled.
ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "accounts_default_party_id_fkey";
DROP INDEX IF EXISTS "accounts_default_party";
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "default_party_id";
