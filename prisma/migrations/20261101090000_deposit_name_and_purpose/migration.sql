-- deposit_name_and_purpose
-- A deposit gets the name the committee knows it by, and states its purpose
-- outright. A pooja deposit is the one that names a slot, so the two are held
-- in step by a constraint rather than trusted to agree.

CREATE TYPE "deposit_purpose" AS ENUM ('general', 'pooja');

ALTER TABLE "fixed_deposits"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "purpose" "deposit_purpose" NOT NULL DEFAULT 'general';

UPDATE "fixed_deposits" SET "purpose" = 'pooja' WHERE "slot_id" IS NOT NULL;

ALTER TABLE "fixed_deposits"
  ADD CONSTRAINT "pooja_deposit_names_a_slot" CHECK (("purpose" = 'pooja') = ("slot_id" IS NOT NULL)),
  ADD CONSTRAINT "deposit_name_not_blank" CHECK ("name" IS NULL OR btrim("name") <> '');
