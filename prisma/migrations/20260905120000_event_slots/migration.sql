-- The structure of the temple year, separated from the year itself.
--
-- A slot — Week 12, or the மார்கழி occurrence — is fixed once and left alone.
-- Sponsors attach to it, and it is dated afresh each year. Until now it had no
-- row anywhere: it existed only as a number between 1 and no_of_instances,
-- which is why its name ended up copied onto two tables with a rule deciding
-- which of them won.

-- ------------------------------------------------------------------- guard
--
-- A slot ends up with one name. Where a type's occurrences each carry their own
-- name — twelve Tamil months hanging off a single slot — collapsing them would
-- destroy eleven of the twelve.
--
-- Checked before anything is created or dropped, so a refusal leaves the
-- database exactly as it was. The fix is to give that type as many instances as
-- it has names and renumber its occurrences onto them, then migrate.
DO $$
DECLARE
  offending TEXT;
BEGIN
  WITH clash AS (
    SELECT t.name_ta AS type_name,
           e.instance_identifier AS slot,
           string_agg(DISTINCT e.custom_instance_name, ' / ') AS names
    FROM events e
    JOIN event_types t ON t.id = e.event_type_id
    WHERE e.custom_instance_name IS NOT NULL
    GROUP BY t.name_ta, e.instance_identifier
    HAVING count(DISTINCT e.custom_instance_name) > 1
  )
  SELECT string_agg(format('%s slot %s: %s', type_name, slot, names), E'\n  ')
    INTO offending
  FROM clash;

  IF offending IS NOT NULL THEN
    -- RAISE's placeholder is %, not %s.
    RAISE EXCEPTION E'These slots carry more than one name, and a slot holds only one:\n  %\nRaise the type''s no_of_instances and renumber its occurrences first.',
      offending;
  END IF;
END $$;

-- ------------------------------------------------------------------- slots

CREATE TABLE "event_slots" (
  "id"                   SERIAL PRIMARY KEY,
  "event_type_id"        INTEGER NOT NULL,
  "instance_identifier"  SMALLINT NOT NULL,
  "custom_instance_name" TEXT,
  "is_active"            BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE "event_slots"
  ADD CONSTRAINT "event_slots_event_type_id_fkey"
  FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "one_slot_per_instance"
  ON "event_slots"("event_type_id", "instance_identifier");

-- Every instance a type declares...
INSERT INTO "event_slots" ("event_type_id", "instance_identifier")
SELECT t."id", g.n
FROM "event_types" t
CROSS JOIN LATERAL generate_series(1, GREATEST(t."no_of_instances", 1)) AS g(n);

-- ...plus any an existing row already refers to beyond that range, so nothing
-- is orphaned by a type whose instance count was later reduced.
INSERT INTO "event_slots" ("event_type_id", "instance_identifier")
SELECT DISTINCT e."event_type_id", e."instance_identifier"
FROM "events" e
ON CONFLICT ("event_type_id", "instance_identifier") DO NOTHING;

INSERT INTO "event_slots" ("event_type_id", "instance_identifier")
SELECT DISTINCT s."event_type_id", s."instance_identifier"
FROM "event_type_sponsors" s
WHERE s."instance_identifier" IS NOT NULL
ON CONFLICT ("event_type_id", "instance_identifier") DO NOTHING;

-- The name moves to the slot, preferring the sponsor's copy where both exist —
-- the precedence the application already applied when reading them.
UPDATE "event_slots" sl
SET "custom_instance_name" = COALESCE(
      (SELECT s."custom_instance_name"
       FROM "event_type_sponsors" s
       WHERE s."event_type_id" = sl."event_type_id"
         AND s."instance_identifier" = sl."instance_identifier"
         AND s."custom_instance_name" IS NOT NULL
       LIMIT 1),
      (SELECT e."custom_instance_name"
       FROM "events" e
       WHERE e."event_type_id" = sl."event_type_id"
         AND e."instance_identifier" = sl."instance_identifier"
         AND e."custom_instance_name" IS NOT NULL
       LIMIT 1));

-- ----------------------------------------------------- sponsors point at slots

ALTER TABLE "event_type_sponsors" ADD COLUMN "slot_id" INTEGER;

UPDATE "event_type_sponsors" s
SET "slot_id" = sl."id"
FROM "event_slots" sl
WHERE sl."event_type_id" = s."event_type_id"
  AND sl."instance_identifier" = s."instance_identifier";

ALTER TABLE "event_type_sponsors"
  ADD CONSTRAINT "event_type_sponsors_slot_id_fkey"
  FOREIGN KEY ("slot_id") REFERENCES "event_slots"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "one_sponsor_per_slot";
DROP INDEX IF EXISTS "sponsors_by_slot";

ALTER TABLE "event_type_sponsors"
  DROP COLUMN "instance_identifier",
  DROP COLUMN "custom_instance_name";

CREATE UNIQUE INDEX "one_sponsor_per_slot"
  ON "event_type_sponsors"("event_type_id", "slot_id", "party_id");
CREATE INDEX "sponsors_by_slot" ON "event_type_sponsors"("slot_id");

-- ------------------------------------------------------- events point at slots

ALTER TABLE "events" ADD COLUMN "slot_id" INTEGER;

UPDATE "events" e
SET "slot_id" = sl."id"
FROM "event_slots" sl
WHERE sl."event_type_id" = e."event_type_id"
  AND sl."instance_identifier" = e."instance_identifier";

ALTER TABLE "events" ALTER COLUMN "slot_id" SET NOT NULL;

ALTER TABLE "events"
  ADD CONSTRAINT "events_slot_id_fkey"
  FOREIGN KEY ("slot_id") REFERENCES "event_slots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_event_type_id_fkey";
DROP INDEX IF EXISTS "events_by_slot";

ALTER TABLE "events"
  DROP COLUMN "event_type_id",
  DROP COLUMN "instance_identifier",
  DROP COLUMN "custom_instance_name";

-- Two occurrences of one slot on one day is a duplicate, not a second pooja.
-- Added last so the backfill above cannot trip over it.
CREATE UNIQUE INDEX "one_occurrence_per_slot_day" ON "events"("slot_id", "scheduled_date");
