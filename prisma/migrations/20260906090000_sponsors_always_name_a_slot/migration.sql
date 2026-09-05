-- A sponsorship always names a slot.
--
-- "All instances" was a way of saying "all of these" that nothing could act
-- on: the schedule had to fan it back out to the slots anyway, and it left a
-- nullable link whose only meaning was the same as a row per slot. Every type
-- has slots, so there is nothing else a sponsor could attach to.

-- Say it plainly rather than let a row vanish: a type-wide sponsorship becomes
-- one row per slot, which is what it always meant.
INSERT INTO "event_type_sponsors" ("slot_id", "party_id", "created_at")
SELECT sl."id", s."party_id", s."created_at"
FROM "event_type_sponsors" s
JOIN "event_slots" sl ON sl."event_type_id" = s."event_type_id"
WHERE s."slot_id" IS NULL
ON CONFLICT DO NOTHING;

DELETE FROM "event_type_sponsors" WHERE "slot_id" IS NULL;

ALTER TABLE "event_type_sponsors" ALTER COLUMN "slot_id" SET NOT NULL;

-- The type is reached through the slot now, so the column beside it was a
-- second way of saying the same thing.
ALTER TABLE "event_type_sponsors" DROP CONSTRAINT IF EXISTS "event_type_sponsors_event_type_id_fkey";
DROP INDEX IF EXISTS "one_sponsor_per_slot";
DROP INDEX IF EXISTS "sponsors_by_slot";

ALTER TABLE "event_type_sponsors" DROP COLUMN "event_type_id";

CREATE UNIQUE INDEX "one_sponsor_per_slot"
  ON "event_type_sponsors"("slot_id", "party_id");
