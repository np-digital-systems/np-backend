-- sanththa_list_starts_empty
-- Hand-written SQL: constraints, indexes, triggers and data fixes that
-- the Prisma schema language cannot express. Prisma will apply this in order
-- and will not diff its contents.
--
-- sanththa_by_year carried every member with `subscribes` onto this year's list,
-- and `subscribes` had defaulted to on, so the whole register landed there. The
-- list is meant to start empty: pooja sponsors owe by sponsoring, and others are
-- added by choice. The carried-over rows were all written in that one statement,
-- so they share its timestamp; rows added on the Sanththa page since are later.
-- A member who has already paid for the year keeps their place.

DELETE FROM "sanththa_enrolments" e
 WHERE e."created_at" = (SELECT min("created_at") FROM "sanththa_enrolments")
   AND NOT EXISTS (
     SELECT 1 FROM "sanththa_payments" p
      WHERE p."member_id" = e."member_id"
        AND p."year" = e."year"
   );
