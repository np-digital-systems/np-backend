-- first_costing_has_always_applied
-- Hand-written SQL: constraints, indexes, triggers and data fixes that
-- the Prisma schema language cannot express. Prisma will apply this in order
-- and will not diff its contents.
--
-- A costing used to begin on the day it was written, which meant it could never
-- price a day that had already passed: a festival kept in August, costed in
-- September, resolved to nothing at all. The first version of a scope has no
-- predecessor to start after, so it starts nowhere — it has always applied, and
-- goes on applying until something replaces it.

ALTER TABLE "event_costings" ALTER COLUMN "effective_from" DROP NOT NULL;

-- `effective_to >= effective_from` says nothing when there is no start.
ALTER TABLE "event_costings"
  DROP CONSTRAINT IF EXISTS "costing_period_is_forwards";

ALTER TABLE "event_costings"
  ADD CONSTRAINT "costing_period_is_forwards" CHECK (
    "effective_from" IS NULL
    OR "effective_to" IS NULL
    OR "effective_to" >= "effective_from"
  );

/*
 * The exclusion constraint needs no change and is rebuilt only because the
 * column under it changed nullability: `daterange(NULL, x, '[]')` is already
 * the range with no lower bound, which is exactly what "has always applied"
 * means. Two versions of one scope still cannot both claim a day.
 */
ALTER TABLE "event_costings"
  DROP CONSTRAINT IF EXISTS "one_costing_per_scope_at_a_time";

ALTER TABLE "event_costings"
  ADD CONSTRAINT "one_costing_per_scope_at_a_time" EXCLUDE USING gist (
    "event_type_id" WITH =,
    (coalesce("slot_id", 0)) WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  );

/*
 * What is already stored was written under the old rule, so the earliest
 * version of every scope is opened backwards to match what the temple meant by
 * it. Later versions keep their dates: those boundaries were real decisions.
 */
UPDATE "event_costings" c
   SET "effective_from" = NULL
 WHERE NOT EXISTS (
   SELECT 1 FROM "event_costings" earlier
    WHERE earlier."event_type_id" = c."event_type_id"
      AND coalesce(earlier."slot_id", 0) = coalesce(c."slot_id", 0)
      AND earlier."effective_from" < c."effective_from"
 );
