-- costings_are_numbered_versions
-- Hand-written SQL: a column type change, a backfill and the two constraints
-- that rest on it. Prisma will apply this in order and will not diff it.
--
-- A version used to begin on a date, so two of them could not both claim one
-- day: applying a second time in an afternoon overwrote the morning's figures
-- instead of recording them. The committee does revise three times in a sitting,
-- and each of those is a decision, so a version now begins at an instant.
--
-- What a pooja costs on a given day does not change. A day is still priced by
-- the version in force at the end of it, which is the figure the temple had
-- settled on by the time the day was over.

ALTER TABLE "event_costings"
  DROP CONSTRAINT IF EXISTS "one_costing_per_scope_at_a_time",
  DROP CONSTRAINT IF EXISTS "costing_period_is_forwards";

/*
 * A date becomes the first instant of that day, in the zone the temple keeps.
 * Asia/Colombo, not UTC: a version dated the 21st began on the temple's 21st,
 * and reading it as midnight UTC would move it into the previous evening.
 */
ALTER TABLE "event_costings"
  ALTER COLUMN "effective_from" TYPE timestamptz(6)
    USING "effective_from"::timestamp AT TIME ZONE 'Asia/Colombo',
  ALTER COLUMN "effective_to" TYPE timestamptz(6)
    USING (("effective_to" + 1)::timestamp AT TIME ZONE 'Asia/Colombo');

/*
 * `effective_to` was the last day the version covered, inclusive. As an instant
 * it becomes the moment the successor took over — the start of the day after —
 * so the ranges below can meet exactly rather than leaving a gap between them.
 */

ALTER TABLE "event_costings"
  ADD CONSTRAINT "costing_period_is_forwards" CHECK (
    "effective_from" IS NULL
    OR "effective_to" IS NULL
    OR "effective_to" >= "effective_from"
  );

-- ── one version in force per scope at any instant, drafts exempt ────────────

/*
 * Half-open, '[)': a version ends at the instant its successor begins, and the
 * two do not overlap there. With dates this had to be the day before; with
 * instants they can meet, which is what lets three versions share an afternoon.
 *
 * Drafts stay exempt. A draft prices nothing until it is applied, so it may sit
 * beside the version it would replace.
 */
ALTER TABLE "event_costings"
  ADD CONSTRAINT "one_costing_per_scope_at_a_time" EXCLUDE USING gist (
    "event_type_id" WITH =,
    (coalesce("slot_id", 0)) WITH =,
    tstzrange("effective_from", "effective_to", '[)') WITH &&
  ) WHERE ("status" <> 'draft');

-- ── version numbers ────────────────────────────────────────────────────────

ALTER TABLE "event_costings" ADD COLUMN "version_no" integer;

/*
 * 1, 2, 3 within the scope, oldest first. A null start sorts first because it
 * is the version that has always applied, and so is version 1 of its scope.
 */
WITH numbered AS (
  SELECT id, row_number() OVER (
           PARTITION BY "event_type_id", coalesce("slot_id", 0)
           ORDER BY "effective_from" ASC NULLS FIRST, id ASC
         ) AS n
    FROM "event_costings"
   WHERE "status" <> 'draft'
)
UPDATE "event_costings" c
   SET "version_no" = numbered.n
  FROM numbered
 WHERE c.id = numbered.id;

-- A draft has no number, and an applied version always has one.
ALTER TABLE "event_costings"
  ADD CONSTRAINT "applied_costings_are_numbered" CHECK (
    ("status" = 'draft') = ("version_no" IS NULL)
  );

CREATE UNIQUE INDEX "costings_version_no"
  ON "event_costings" ("event_type_id", coalesce("slot_id", 0), "version_no")
  WHERE "version_no" IS NOT NULL;
