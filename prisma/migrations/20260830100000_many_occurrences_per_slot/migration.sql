-- A slot may hold more than one dated occurrence in a year.
--
-- `one_occurrence_per_slot_per_year` assumed the instance number identified a
-- slot within the year, which holds for weekly (52) and annual (1) types but
-- not the monthly ones: `monthly_once` has a single instance yet recurs twelve
-- times a year, so its second month collided with its first and could never be
-- scheduled. The uniqueness goes; the lookup it also served is kept as a plain
-- index.

-- DropIndex
DROP INDEX "one_occurrence_per_slot_per_year";

-- CreateIndex
CREATE INDEX "events_by_slot" ON "events" ("event_type_id", "instance_identifier");
