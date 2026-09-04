-- Where receipts for a pooja type are carried, recorded once on the type so a
-- clerk raising a receipt does not answer it again for every occurrence.
ALTER TABLE "event_types"
  ADD COLUMN "default_fund_id" INTEGER,
  ADD COLUMN "default_project_id" INTEGER;

-- SET NULL, not CASCADE: closing a fund must not take the pooja type with it.
-- The type simply stops suggesting a fund and the clerk chooses one again.
ALTER TABLE "event_types"
  ADD CONSTRAINT "event_types_default_fund_id_fkey"
  FOREIGN KEY ("default_fund_id") REFERENCES "funds"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "event_types"
  ADD CONSTRAINT "event_types_default_project_id_fkey"
  FOREIGN KEY ("default_project_id") REFERENCES "projects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "event_types_default_fund" ON "event_types"("default_fund_id");
