-- CreateEnum
CREATE TYPE "costing_status" AS ENUM ('draft', 'active', 'superseded');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "costing_id" INTEGER,
ADD COLUMN     "sponsor_amount" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "event_costings" (
    "id" SERIAL NOT NULL,
    "event_type_id" INTEGER NOT NULL,
    "slot_id" INTEGER,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" "costing_status" NOT NULL DEFAULT 'draft',
    "sponsor_amount" DECIMAL(12,2) NOT NULL,
    "income_account_id" INTEGER NOT NULL,
    "income_fund_id" INTEGER NOT NULL,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_costings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_costing_lines" (
    "id" SERIAL NOT NULL,
    "costing_id" INTEGER NOT NULL,
    "parent_line_id" INTEGER,
    "line_no" SMALLINT NOT NULL,
    "label" TEXT,
    "account_id" INTEGER NOT NULL,
    "fund_id" INTEGER NOT NULL,
    "activity_id" INTEGER,
    "party_id" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "quantity" DECIMAL(10,3),
    "unit_amount" DECIMAL(12,2),
    "charged_to_sponsor" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "event_costing_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_budget_lines" (
    "id" BIGSERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "label" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "fund_id" INTEGER NOT NULL,
    "activity_id" INTEGER,
    "party_id" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "charged_to_sponsor" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "event_budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "costings_scope" ON "event_costings"("event_type_id", "slot_id");

-- CreateIndex
CREATE INDEX "costings_status" ON "event_costings"("status");

-- CreateIndex
CREATE INDEX "costings_income_account" ON "event_costings"("income_account_id");

-- CreateIndex
CREATE INDEX "costings_income_fund" ON "event_costings"("income_fund_id");

-- CreateIndex
CREATE INDEX "costings_created_by" ON "event_costings"("created_by");

-- CreateIndex
CREATE INDEX "costing_lines_costing" ON "event_costing_lines"("costing_id");

-- CreateIndex
CREATE INDEX "costing_lines_parent" ON "event_costing_lines"("parent_line_id");

-- CreateIndex
CREATE INDEX "costing_lines_account" ON "event_costing_lines"("account_id");

-- CreateIndex
CREATE INDEX "costing_lines_fund" ON "event_costing_lines"("fund_id");

-- CreateIndex
CREATE INDEX "costing_lines_activity" ON "event_costing_lines"("activity_id");

-- CreateIndex
CREATE INDEX "costing_lines_party" ON "event_costing_lines"("party_id");

-- CreateIndex
CREATE UNIQUE INDEX "costing_line_no" ON "event_costing_lines"("costing_id", "line_no");

-- CreateIndex
CREATE INDEX "budget_lines_event_account" ON "event_budget_lines"("event_id", "account_id");

-- CreateIndex
CREATE INDEX "budget_lines_account" ON "event_budget_lines"("account_id");

-- CreateIndex
CREATE INDEX "budget_lines_fund" ON "event_budget_lines"("fund_id");

-- CreateIndex
CREATE INDEX "budget_lines_activity" ON "event_budget_lines"("activity_id");

-- CreateIndex
CREATE INDEX "budget_lines_party" ON "event_budget_lines"("party_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_line_no" ON "event_budget_lines"("event_id", "line_no");

-- CreateIndex
CREATE INDEX "events_costing" ON "events"("costing_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_costing_id_fkey" FOREIGN KEY ("costing_id") REFERENCES "event_costings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_costings" ADD CONSTRAINT "event_costings_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_costings" ADD CONSTRAINT "event_costings_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "event_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_costings" ADD CONSTRAINT "event_costings_income_account_id_fkey" FOREIGN KEY ("income_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_costings" ADD CONSTRAINT "event_costings_income_fund_id_fkey" FOREIGN KEY ("income_fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_costings" ADD CONSTRAINT "event_costings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_costing_lines" ADD CONSTRAINT "event_costing_lines_costing_id_fkey" FOREIGN KEY ("costing_id") REFERENCES "event_costings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_costing_lines" ADD CONSTRAINT "event_costing_lines_parent_line_id_fkey" FOREIGN KEY ("parent_line_id") REFERENCES "event_costing_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_costing_lines" ADD CONSTRAINT "event_costing_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_costing_lines" ADD CONSTRAINT "event_costing_lines_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_costing_lines" ADD CONSTRAINT "event_costing_lines_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_costing_lines" ADD CONSTRAINT "event_costing_lines_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_budget_lines" ADD CONSTRAINT "event_budget_lines_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_budget_lines" ADD CONSTRAINT "event_budget_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_budget_lines" ADD CONSTRAINT "event_budget_lines_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_budget_lines" ADD CONSTRAINT "event_budget_lines_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_budget_lines" ADD CONSTRAINT "event_budget_lines_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
