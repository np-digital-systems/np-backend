-- sanththa_by_year
-- Hand-written SQL: constraints, indexes, triggers and data fixes that
-- the Prisma schema language cannot express. Prisma will apply this in order
-- and will not diff its contents.
--
-- Who owes the sanththa is decided year by year on the sanththa list, not on the
-- member. Each year starts empty: a member sponsoring a pooja that year owes it
-- automatically, and any other member who chooses to pay is added for that year
-- alone. The standing `subscribes` flag goes; members who had opted in are added
-- for the current year so this year's list keeps them.

CREATE TABLE "sanththa_enrolments" (
  "member_id"  INTEGER NOT NULL,
  "year"       INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sanththa_enrolments_pkey" PRIMARY KEY ("member_id", "year"),
  CONSTRAINT "enrolment_year_sane" CHECK ("year" BETWEEN 2000 AND 2100)
);

CREATE INDEX "enrolments_year" ON "sanththa_enrolments"("year");

ALTER TABLE "sanththa_enrolments" ADD CONSTRAINT "sanththa_enrolments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("party_id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "sanththa_enrolments" ("member_id", "year")
SELECT "party_id", EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
  FROM "members"
 WHERE "subscribes";

ALTER TABLE "members" DROP COLUMN "subscribes";
