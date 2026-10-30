-- voucher_types_integrity
-- Hand-written SQL: constraints, indexes, triggers and data fixes that
-- the Prisma schema language cannot express. Prisma will apply this in order
-- and will not diff its contents.
--
-- A journal moves no money, so it is the one kind with no mode and no bank
-- account; every other kind keeps the rule that only cash has no bank account.

ALTER TABLE "vouchers" DROP CONSTRAINT "cash_has_no_bank";

ALTER TABLE "vouchers"
  ADD CONSTRAINT "journal_has_no_mode" CHECK (("kind" = 'journal') = ("mode" IS NULL)),
  ADD CONSTRAINT "cash_has_no_bank" CHECK (
    "mode" IS NULL AND "bank_account_id" IS NULL
    OR "mode" IS NOT NULL AND ("mode" = 'cash') = ("bank_account_id" IS NULL)
  );
