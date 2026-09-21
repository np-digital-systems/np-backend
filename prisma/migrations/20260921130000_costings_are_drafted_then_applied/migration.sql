-- costings_are_drafted_then_applied
-- Hand-written SQL: an enum, a column, a backfill and the exclusion constraint
-- that has to change with it. Prisma will apply this in order and will not
-- diff its contents.
--
-- Saving a costing no longer changes what anything is quoted at. A save writes
-- a draft; the committee applies it, and only then does it become the version
-- in force and close the one before it.
--
-- Applied after `first_costing_has_always_applied`, whose constraint this one
-- supersedes: the drafts exemption has to be the last word on it. The range
-- below is unchanged from that migration otherwise, and daterange(NULL, x) is
-- still the open start it introduced.
--
-- This restores the status column dropped in `costings_follow_the_activity`.
-- What that migration removed was a draft nobody applied deliberately: every
-- edit became a version, so a typo corrected the next morning was recorded as
-- a rate change the temple never made. A draft is how that is told apart from
-- a revision, and it is the committee pressing Apply that says which it was.

CREATE TYPE "costing_status" AS ENUM ('draft', 'in-force', 'superseded');

ALTER TABLE "event_costings"
  ADD COLUMN "status" "costing_status" NOT NULL DEFAULT 'draft';

/*
 * Everything already saved was in force by the rule of the day it was saved
 * under: what was written applied. Nothing becomes a draft retrospectively,
 * or a rate the temple has been quoting from would quietly stop applying.
 */
UPDATE "event_costings"
  SET "status" = CASE WHEN "effective_to" IS NULL THEN 'in-force' ELSE 'superseded' END::"costing_status";

CREATE INDEX "costings_status" ON "event_costings" ("status");

-- ── one costing in force per scope, drafts exempt ───────────────────────────

/*
 * The scope is the pair (type, slot), a null slot being its own scope covering
 * the whole type — so a slot's own version and the type-wide one overlap in
 * time on purpose, and that overlap is what resolution exists to settle. What
 * may not overlap is two applied versions of the same scope, because then no
 * date could say which figure it was quoted at.
 *
 * Drafts are exempt. A draft has a date it would start from, but it prices
 * nothing until it is applied, so two of them — or a draft and the version it
 * would replace — may sit on the same day without contradicting each other.
 */
ALTER TABLE "event_costings"
  DROP CONSTRAINT IF EXISTS "one_costing_per_scope_at_a_time";

ALTER TABLE "event_costings"
  ADD CONSTRAINT "one_costing_per_scope_at_a_time" EXCLUDE USING gist (
    "event_type_id" WITH =,
    (coalesce("slot_id", 0)) WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  ) WHERE ("status" <> 'draft');

-- A closed version is a superseded one: the two ways of saying "no longer in
-- force" cannot be allowed to disagree.
ALTER TABLE "event_costings"
  DROP CONSTRAINT IF EXISTS "closed_costings_are_superseded";

ALTER TABLE "event_costings"
  ADD CONSTRAINT "closed_costings_are_superseded" CHECK (
    ("effective_to" IS NULL) = ("status" <> 'superseded')
  );
