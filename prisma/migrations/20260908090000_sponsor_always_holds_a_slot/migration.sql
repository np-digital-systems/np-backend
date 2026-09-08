-- A sponsor holds a slot, and the slot says which event type it belongs to.
--
-- Two changes, and the second is the point of the first. `slot_id` becomes
-- required, and `event_type_id` — which existed only because `slot_id` could be
-- null — goes away. The type is recorded in one place from here on,
-- `event_slots.event_type_id`, so a sponsor row can no longer name a type that
-- disagrees with the slot it points at.

-- The old index spans the column being dropped and, more immediately, would
-- reject the backfill below as it collapses the unplaced pool onto one slot.
-- It goes first; its replacement is created at the end.
DROP INDEX IF EXISTS "one_sponsor_per_slot";

-- ------------------------------------------------------------------ backfill
--
-- Unplaced rows are given their OWN type's first slot, not a fixed id. A
-- literal `slot_id = 1` would move every unplaced sponsor onto whichever type
-- happens to own that slot, and once `event_type_id` is dropped there is
-- nothing left to recover the right type from — the placement is a placeholder,
-- but the type it sits under has to survive it.

-- A type nobody has scheduled yet may have no first slot to be placed on.
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

-- Collapsing the pool onto one slot can collide: the same party waiting twice
-- on a type, or waiting while already holding that type's first slot. The
-- earliest registration is the real one; the rest recorded the same promise
-- again and are dropped so the unique index at the end can be created.
DELETE FROM "event_type_sponsors" a
USING "event_type_sponsors" b
WHERE a."id" > b."id"
  AND a."slot_id" = b."slot_id"
  AND a."party_id" = b."party_id";

ALTER TABLE "event_type_sponsors" ALTER COLUMN "slot_id" SET NOT NULL;

-- --------------------------------------------------- one home for the type

-- The funding guard reads the column directly, so it has to be taught the slot
-- before the column can go. Its sibling on `events` already reads this way.
DROP TRIGGER IF EXISTS "type_takes_sponsors" ON "event_type_sponsors";

CREATE OR REPLACE FUNCTION assert_type_takes_sponsors() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM event_slots s
      JOIN event_types et ON et.id = s.event_type_id
     WHERE s.id = NEW.slot_id
       AND et.funding = 'general'
  ) THEN
    RAISE EXCEPTION 'this observance is funded by collection and takes no registered sponsors'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Redundant once the unique index below leads on the same column.
DROP INDEX IF EXISTS "sponsors_by_slot";

ALTER TABLE "event_type_sponsors"
  DROP CONSTRAINT IF EXISTS "event_type_sponsors_event_type_id_fkey";

ALTER TABLE "event_type_sponsors" DROP COLUMN "event_type_id";

CREATE UNIQUE INDEX "one_sponsor_per_slot"
  ON "event_type_sponsors"("slot_id", "party_id");

CREATE CONSTRAINT TRIGGER "type_takes_sponsors"
  AFTER INSERT OR UPDATE OF "slot_id" ON "event_type_sponsors"
  FOR EACH ROW EXECUTE FUNCTION assert_type_takes_sponsors();
