-- A sponsor holds a slot, and the slot says which event type it belongs to.
--
-- Two changes, and the second is the point of the first. `slot_id` becomes
-- required, and `event_type_id` — which only existed because `slot_id` could be
-- null — goes away. The type is now recorded in exactly one place,
-- `event_slots.event_type_id`, so a sponsor row can no longer name a type that
-- disagrees with the slot it points at.

-- ------------------------------------------------------------------ backfill
--
-- Unplaced rows are given their OWN type's first slot, not a fixed id. A
-- literal `slot_id = 1` would move every unplaced sponsor onto whichever type
-- owns that slot, and once `event_type_id` is dropped there is nothing left to
-- recover the right type from — the placement is a placeholder, but the type
-- it is under must survive it.

-- The first slot may not exist for a type nobody has scheduled yet.
INSERT INTO "event_slots" ("event_type_id", "instance_identifier")
SELECT DISTINCT s."event_type_id", 1
FROM "event_type_sponsors" s
WHERE s."slot_id" IS NULL
ON CONFLICT ("event_type_id", "instance_identifier") DO NOTHING;

UPDATE "event_type_sponsors" s
SET "slot_id" = sl."id"
FROM "event_slots" sl
WHERE s."slot_id" IS NULL
  AND sl."event_type_id" = s."event_type_id"
  AND sl."instance_identifier" = 1;

-- Collapsing the pool onto one slot can collide: two rows for the same party
-- waiting on the same type, or one waiting while another already holds slot 1.
-- The oldest registration is the real one; the rest were the same promise
-- recorded twice and are dropped so the unique index below can be created.
DELETE FROM "event_type_sponsors" a
USING "event_type_sponsors" b
WHERE a."id" > b."id"
  AND a."slot_id" = b."slot_id"
  AND a."party_id" = b."party_id";

ALTER TABLE "event_type_sponsors" ALTER COLUMN "slot_id" SET NOT NULL;

-- --------------------------------------------------- one home for the type

DROP INDEX IF EXISTS "one_sponsor_per_slot";

ALTER TABLE "event_type_sponsors"
  DROP CONSTRAINT IF EXISTS "event_type_sponsors_event_type_id_fkey";

ALTER TABLE "event_type_sponsors" DROP COLUMN "event_type_id";

CREATE UNIQUE INDEX "one_sponsor_per_slot"
  ON "event_type_sponsors"("slot_id", "party_id");
