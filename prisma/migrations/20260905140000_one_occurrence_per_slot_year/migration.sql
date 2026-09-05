-- A slot is scheduled once a year.
--
-- Week 12 happens once in 2027. Setting it out twice is a clerk scheduling the
-- same slot by mistake, not the temple holding the pooja twice — and a receipt
-- coded to "Week 12, 2027" would then have two occurrences to point at.
--
-- The day-level rule this replaces was too weak: it allowed the same slot on
-- two different days of one year, which is the mistake actually worth stopping.

-- Refuse rather than destroy, as elsewhere: if a slot is already scheduled
-- twice in a year, say which before creating anything.
DO $$
DECLARE
  offending TEXT;
BEGIN
  WITH clash AS (
    SELECT t.name_ta AS type_name,
           sl.instance_identifier AS slot,
           EXTRACT(YEAR FROM e.scheduled_date)::int AS yr,
           count(*) AS dates
    FROM events e
    JOIN event_slots sl ON sl.id = e.slot_id
    JOIN event_types t ON t.id = sl.event_type_id
    GROUP BY 1, 2, 3
    HAVING count(*) > 1
  )
  SELECT string_agg(format('%s slot %s in %s: %s dates', type_name, slot, yr, dates), E'\n  ')
    INTO offending
  FROM clash;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION E'These slots are scheduled more than once in a year:\n  %\nRemove the duplicates, or give the type enough instances for each occurrence.',
      offending;
  END IF;
END $$;

-- Expression indexes cannot be written in the Prisma schema, so this lives in
-- SQL alone — as the posted-voucher triggers already do. `prisma migrate dev`
-- will not see it; `migrate deploy` leaves it alone.
DROP INDEX IF EXISTS "one_occurrence_per_slot_day";

CREATE UNIQUE INDEX "one_occurrence_per_slot_year"
  ON "events"("slot_id", (EXTRACT(YEAR FROM "scheduled_date")));
