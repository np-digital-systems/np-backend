-- voucher_types
-- Contra and journal vouchers, journal line sides, and the columns that let a
-- fixed deposit's principal be carried on its asset head.
--
-- Enum values are added here and only used in the next migration: PostgreSQL
-- will not let a transaction use an enum value it has just added.

ALTER TYPE "voucher_kind" ADD VALUE 'contra';
ALTER TYPE "voucher_kind" ADD VALUE 'journal';

CREATE TYPE "entry_side" AS ENUM ('debit', 'credit');
CREATE TYPE "deposit_source" AS ENUM ('bank', 'endowment', 'renewal', 'opening');

ALTER TABLE "vouchers" ALTER COLUMN "mode" DROP NOT NULL;

ALTER TABLE "voucher_lines" ADD COLUMN "side" "entry_side";

-- Every deposit already recorded was held before the books carried deposits.
ALTER TABLE "fixed_deposits"
  ADD COLUMN "ledger_account_id" INTEGER,
  ADD COLUMN "source" "deposit_source" NOT NULL DEFAULT 'opening',
  ADD COLUMN "placement_voucher_id" BIGINT,
  ADD COLUMN "closure_voucher_id" BIGINT;

CREATE INDEX "deposits_ledger_account" ON "fixed_deposits"("ledger_account_id");
CREATE INDEX "deposits_placement_voucher" ON "fixed_deposits"("placement_voucher_id");
CREATE INDEX "deposits_closure_voucher" ON "fixed_deposits"("closure_voucher_id");

ALTER TABLE "fixed_deposits" ADD CONSTRAINT "fixed_deposits_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fixed_deposits" ADD CONSTRAINT "fixed_deposits_placement_voucher_id_fkey" FOREIGN KEY ("placement_voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fixed_deposits" ADD CONSTRAINT "fixed_deposits_closure_voucher_id_fkey" FOREIGN KEY ("closure_voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
