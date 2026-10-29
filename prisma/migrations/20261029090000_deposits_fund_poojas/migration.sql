-- deposits_fund_poojas
-- A sponsor places one or more fixed deposits so the interest pays for their
-- pooja each year. The deposit names the slot it pays for, and every interest
-- receipt names the deposit it came from, so a slot's year can be read as
-- interest received against what the pooja cost.
--
-- No backfill: every existing deposit stays a kovil deposit until it is linked.

ALTER TABLE "fixed_deposits" ADD COLUMN "slot_id" INTEGER;
ALTER TABLE "voucher_lines" ADD COLUMN "fixed_deposit_id" INTEGER;
ALTER TABLE "ledger_entries" ADD COLUMN "fixed_deposit_id" INTEGER;

CREATE INDEX "deposits_slot" ON "fixed_deposits"("slot_id");
CREATE INDEX "voucher_lines_fixed_deposit" ON "voucher_lines"("fixed_deposit_id");
CREATE INDEX "ledger_fixed_deposit" ON "ledger_entries"("fixed_deposit_id");

ALTER TABLE "fixed_deposits" ADD CONSTRAINT "fixed_deposits_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "event_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_fixed_deposit_id_fkey" FOREIGN KEY ("fixed_deposit_id") REFERENCES "fixed_deposits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_fixed_deposit_id_fkey" FOREIGN KEY ("fixed_deposit_id") REFERENCES "fixed_deposits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
