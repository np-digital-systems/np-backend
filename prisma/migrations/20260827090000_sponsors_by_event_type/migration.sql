-- A sponsor is now registered against an event type, with the instance optional.
-- Several sponsors may share a type (and a slot), so the one-per-slot rule goes.

-- DropIndex
DROP INDEX "one_sponsor_per_slot";

-- AlterTable
ALTER TABLE "event_type_sponsors" ALTER COLUMN "instance_identifier" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "one_sponsor_per_slot" ON "event_type_sponsors"("event_type_id", "instance_identifier", "user_id");

-- CreateIndex
CREATE INDEX "sponsors_by_slot" ON "event_type_sponsors"("event_type_id", "instance_identifier");
