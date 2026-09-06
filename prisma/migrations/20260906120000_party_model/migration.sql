-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "account_role" AS ENUM ('admin', 'accountant', 'cashier', 'member');

-- CreateEnum
CREATE TYPE "party_type" AS ENUM ('person', 'organisation');

-- CreateEnum
CREATE TYPE "party_kind" AS ENUM ('devotee', 'vendor', 'staff');

-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('planning', 'active', 'on-hold', 'completed');

-- CreateEnum
CREATE TYPE "bank_account_type" AS ENUM ('current', 'savings', 'fixed-deposit');

-- CreateEnum
CREATE TYPE "voucher_kind" AS ENUM ('receipt', 'payment');

-- CreateEnum
CREATE TYPE "voucher_status" AS ENUM ('Draft', 'Pending Approval', 'Approved', 'Rejected', 'Posted', 'Cancelled');

-- CreateEnum
CREATE TYPE "payment_mode" AS ENUM ('cash', 'bank', 'cheque', 'online');

-- CreateEnum
CREATE TYPE "deposit_status" AS ENUM ('active', 'matured', 'renewed', 'closed');

-- CreateEnum
CREATE TYPE "interest_payout" AS ENUM ('monthly', 'quarterly', 'on-maturity');

-- CreateEnum
CREATE TYPE "asset_category" AS ENUM ('land-building', 'jewellery', 'vahanam', 'vessels', 'furniture', 'equipment', 'vehicle');

-- CreateEnum
CREATE TYPE "asset_condition" AS ENUM ('good', 'fair', 'needs-repair', 'unusable');

-- CreateEnum
CREATE TYPE "asset_status" AS ENUM ('in-use', 'in-storage', 'under-repair', 'disposed');

-- CreateEnum
CREATE TYPE "frequency_type" AS ENUM ('weekly', 'monthly_twice', 'monthly_once', 'annual', 'multi_day');

-- CreateEnum
CREATE TYPE "activity_kind" AS ENUM ('pooja', 'service', 'facility', 'general');

-- CreateEnum
CREATE TYPE "event_funding" AS ENUM ('sponsored', 'general');

-- CreateEnum
CREATE TYPE "financial_year_status" AS ENUM ('open', 'closed', 'upcoming');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('create', 'update', 'delete', 'approve', 'reject', 'post', 'login', 'logout', 'permission-change');

-- CreateEnum
CREATE TYPE "notification_category" AS ENUM ('Approval', 'Accounting', 'Event', 'Sanththa', 'Banking', 'Fixed Deposit', 'Financial Year', 'User Administration', 'Security', 'System');

-- CreateEnum
CREATE TYPE "notification_priority" AS ENUM ('Information', 'Reminder', 'Warning', 'Critical');

-- CreateTable
CREATE TABLE "parties" (
    "id" SERIAL NOT NULL,
    "type" "party_type" NOT NULL DEFAULT 'person',
    "name_ta" TEXT NOT NULL,
    "name_en" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "reference_no" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_roles" (
    "party_id" INTEGER NOT NULL,
    "kind" "party_kind" NOT NULL,

    CONSTRAINT "party_roles_pkey" PRIMARY KEY ("party_id","kind")
);

-- CreateTable
CREATE TABLE "sponsors" (
    "party_id" INTEGER NOT NULL,
    "sponsor_no" TEXT NOT NULL,
    "sponsor_since" DATE NOT NULL,
    "subscribes" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("party_id")
);

-- CreateTable
CREATE TABLE "sanththa_rates" (
    "year" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "set_by" UUID,
    "set_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanththa_rates_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "sanththa_payments" (
    "id" SERIAL NOT NULL,
    "sponsor_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "receipt_voucher_id" BIGINT,
    "mode" "payment_mode" NOT NULL,
    "collected_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanththa_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "party_id" INTEGER NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "account_role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device_name" TEXT NOT NULL,
    "ip_address" INET NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "code" "account_role" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "permission_groups" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "permission_groups_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" TEXT NOT NULL,
    "group_code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_code" "account_role" NOT NULL,
    "permission_code" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_code","permission_code")
);

-- CreateTable
CREATE TABLE "financial_years" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "status" "financial_year_status" NOT NULL DEFAULT 'upcoming',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "income" DECIMAL(14,2),
    "expenses" DECIMAL(14,2),
    "voucher_count" INTEGER,
    "closed_on" TIMESTAMPTZ(6),
    "closed_by" UUID,

    CONSTRAINT "financial_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name_ta" TEXT NOT NULL,
    "name_en" TEXT,
    "type" "account_type" NOT NULL,
    "parent_id" INTEGER,
    "is_postable" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "default_party_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funds" (
    "id" SERIAL NOT NULL,
    "name_ta" TEXT NOT NULL,
    "name_en" TEXT,
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "name_ta" TEXT NOT NULL,
    "name_en" TEXT,
    "fund_id" INTEGER NOT NULL,
    "budget" DECIMAL(14,2),
    "start_date" DATE NOT NULL,
    "target_date" DATE,
    "status" "project_status" NOT NULL DEFAULT 'planning',
    "description" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" SERIAL NOT NULL,
    "name_ta" TEXT NOT NULL,
    "name_en" TEXT,
    "kind" "activity_kind" NOT NULL DEFAULT 'general',
    "default_fund_id" INTEGER,
    "default_project_id" INTEGER,
    "default_party_id" INTEGER,
    "default_account_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "type" "bank_account_type" NOT NULL,
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "opened_on" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "ledger_account_id" INTEGER NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" BIGSERIAL NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" "voucher_kind" NOT NULL,
    "financial_year_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "payment_mode" NOT NULL,
    "bank_account_id" INTEGER,
    "cheque_no" TEXT,
    "party_id" INTEGER,
    "party" TEXT NOT NULL,
    "manual_voucher_no" TEXT,
    "status" "voucher_status" NOT NULL DEFAULT 'Draft',
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "posted_at" TIMESTAMPTZ(6),

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_lines" (
    "id" BIGSERIAL NOT NULL,
    "voucher_id" BIGINT NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "fund_id" INTEGER NOT NULL,
    "project_id" INTEGER,
    "activity_id" INTEGER,
    "event_id" INTEGER,

    CONSTRAINT "voucher_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_sequences" (
    "financial_year_id" INTEGER NOT NULL,
    "kind" "voucher_kind" NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_no" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "voucher_sequences_pkey" PRIMARY KEY ("financial_year_id","kind")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "voucher_id" BIGINT NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "date" DATE NOT NULL,
    "account_id" INTEGER NOT NULL,
    "fund_id" INTEGER NOT NULL,
    "project_id" INTEGER,
    "activity_id" INTEGER,
    "party_id" INTEGER,
    "event_id" INTEGER,
    "debit" DECIMAL(14,2),
    "credit" DECIMAL(14,2),
    "bank_account_id" INTEGER,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_deposits" (
    "id" SERIAL NOT NULL,
    "certificate_no" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "interest_rate" DECIMAL(5,2) NOT NULL,
    "placed_on" DATE NOT NULL,
    "matures_on" DATE NOT NULL,
    "tenure_months" SMALLINT NOT NULL,
    "interest_payout" "interest_payout" NOT NULL,
    "fund_id" INTEGER NOT NULL,
    "status" "deposit_status" NOT NULL DEFAULT 'active',
    "renewed_from_id" INTEGER,
    "bank_account_id" INTEGER,
    "notes" TEXT,

    CONSTRAINT "fixed_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" SERIAL NOT NULL,
    "tag" TEXT NOT NULL,
    "name_ta" TEXT NOT NULL,
    "name_en" TEXT,
    "category" "asset_category" NOT NULL,
    "acquired_on" DATE NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "depreciation_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "location" TEXT NOT NULL,
    "condition" "asset_condition" NOT NULL DEFAULT 'good',
    "status" "asset_status" NOT NULL DEFAULT 'in-use',
    "fund_id" INTEGER NOT NULL,
    "disposed_on" DATE,
    "disposal_value" DECIMAL(14,2),
    "notes" TEXT,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_types" (
    "id" SERIAL NOT NULL,
    "name_ta" TEXT NOT NULL,
    "name_en" TEXT,
    "frequency_type" "frequency_type" NOT NULL,
    "no_of_instances" SMALLINT NOT NULL DEFAULT 1,
    "funding" "event_funding" NOT NULL DEFAULT 'sponsored',
    "activity_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_slots" (
    "id" SERIAL NOT NULL,
    "event_type_id" INTEGER NOT NULL,
    "instance_identifier" SMALLINT NOT NULL,
    "custom_instance_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "event_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_type_sponsors" (
    "id" SERIAL NOT NULL,
    "event_type_id" INTEGER NOT NULL,
    "slot_id" INTEGER,
    "party_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_type_sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" SERIAL NOT NULL,
    "slot_id" INTEGER NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6),
    "sponsor_party_id" INTEGER,
    "notes" TEXT,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "actor_name" TEXT NOT NULL,
    "actor_role" "account_role" NOT NULL,
    "action" "audit_action" NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_ref" TEXT,
    "summary" TEXT NOT NULL,
    "ip_address" INET NOT NULL,
    "diff" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" BIGSERIAL NOT NULL,
    "category" "notification_category" NOT NULL,
    "priority" "notification_priority" NOT NULL DEFAULT 'Information',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_ref" TEXT,
    "action_label" TEXT,
    "action_href" TEXT,
    "meta" JSONB,
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_recipients" (
    "notification_id" BIGINT NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "dismissed_at" TIMESTAMPTZ(6),

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("notification_id","user_id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "parties_active" ON "parties"("is_active");

-- CreateIndex
CREATE INDEX "parties_type" ON "parties"("type");

-- CreateIndex
CREATE INDEX "parties_name" ON "parties" USING GIN ("name_ta" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "party_roles_kind" ON "party_roles"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "sponsors_sponsor_no_key" ON "sponsors"("sponsor_no");

-- CreateIndex
CREATE INDEX "sponsors_active" ON "sponsors"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "one_payment_per_receipt" ON "sanththa_payments"("receipt_voucher_id");

-- CreateIndex
CREATE INDEX "payments_year" ON "sanththa_payments"("year");

-- CreateIndex
CREATE INDEX "payments_sponsor" ON "sanththa_payments"("sponsor_id");

-- CreateIndex
CREATE UNIQUE INDEX "one_payment_per_sponsor_per_year" ON "sanththa_payments"("sponsor_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_party_id_key" ON "user_accounts"("party_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_email_key" ON "user_accounts"("email");

-- CreateIndex
CREATE INDEX "user_accounts_role" ON "user_accounts"("role");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_expiry" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "financial_years_label_key" ON "financial_years"("label");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");

-- CreateIndex
CREATE INDEX "accounts_parent" ON "accounts"("parent_id");

-- CreateIndex
CREATE INDEX "accounts_default_party" ON "accounts"("default_party_id");

-- CreateIndex
CREATE UNIQUE INDEX "funds_name_ta_key" ON "funds"("name_ta");

-- CreateIndex
CREATE INDEX "projects_fund" ON "projects"("fund_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "activities_name_ta_key" ON "activities"("name_ta");

-- CreateIndex
CREATE INDEX "activities_kind" ON "activities"("kind", "is_active");

-- CreateIndex
CREATE INDEX "activities_default_fund" ON "activities"("default_fund_id");

-- CreateIndex
CREATE INDEX "activities_default_project" ON "activities"("default_project_id");

-- CreateIndex
CREATE INDEX "activities_default_party" ON "activities"("default_party_id");

-- CreateIndex
CREATE INDEX "activities_default_account" ON "activities"("default_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_ledger_account_id_key" ON "bank_accounts"("ledger_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_account_number" ON "bank_accounts"("bank_name", "account_number");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_ref_key" ON "vouchers"("ref");

-- CreateIndex
CREATE INDEX "vouchers_year_date" ON "vouchers"("financial_year_id", "date" DESC);

-- CreateIndex
CREATE INDEX "vouchers_kind_date" ON "vouchers"("kind", "date" DESC);

-- CreateIndex
CREATE INDEX "vouchers_party" ON "vouchers"("party_id");

-- CreateIndex
CREATE INDEX "vouchers_bank_account" ON "vouchers"("bank_account_id");

-- CreateIndex
CREATE INDEX "vouchers_created_by" ON "vouchers"("created_by");

-- CreateIndex
CREATE INDEX "vouchers_party_text" ON "vouchers" USING GIN ("party" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "voucher_lines_account" ON "voucher_lines"("account_id");

-- CreateIndex
CREATE INDEX "voucher_lines_activity" ON "voucher_lines"("activity_id");

-- CreateIndex
CREATE INDEX "voucher_lines_fund" ON "voucher_lines"("fund_id");

-- CreateIndex
CREATE INDEX "voucher_lines_project" ON "voucher_lines"("project_id");

-- CreateIndex
CREATE INDEX "voucher_lines_event" ON "voucher_lines"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_line_no" ON "voucher_lines"("voucher_id", "line_no");

-- CreateIndex
CREATE INDEX "ledger_account_date" ON "ledger_entries"("account_id", "date");

-- CreateIndex
CREATE INDEX "ledger_fund_date" ON "ledger_entries"("fund_id", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_project" ON "ledger_entries"("project_id");

-- CreateIndex
CREATE INDEX "ledger_entries_bank_account" ON "ledger_entries"("bank_account_id");

-- CreateIndex
CREATE INDEX "ledger_activity_date" ON "ledger_entries"("activity_id", "date");

-- CreateIndex
CREATE INDEX "ledger_party_date" ON "ledger_entries"("party_id", "date");

-- CreateIndex
CREATE INDEX "ledger_event" ON "ledger_entries"("event_id");

-- CreateIndex
CREATE INDEX "ledger_date" ON "ledger_entries"("date");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_line" ON "ledger_entries"("voucher_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_deposits_certificate_no_key" ON "fixed_deposits"("certificate_no");

-- CreateIndex
CREATE INDEX "deposits_maturing" ON "fixed_deposits"("status", "matures_on");

-- CreateIndex
CREATE UNIQUE INDEX "assets_tag_key" ON "assets"("tag");

-- CreateIndex
CREATE INDEX "assets_category" ON "assets"("category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_types_name_ta_key" ON "event_types"("name_ta");

-- CreateIndex
CREATE INDEX "event_types_activity" ON "event_types"("activity_id");

-- CreateIndex
CREATE INDEX "event_types_funding" ON "event_types"("funding");

-- CreateIndex
CREATE UNIQUE INDEX "one_slot_per_instance" ON "event_slots"("event_type_id", "instance_identifier");

-- CreateIndex
CREATE INDEX "sponsors_by_party" ON "event_type_sponsors"("party_id");

-- CreateIndex
CREATE INDEX "sponsors_by_slot" ON "event_type_sponsors"("slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "one_sponsor_per_slot" ON "event_type_sponsors"("event_type_id", "slot_id", "party_id");

-- CreateIndex
CREATE INDEX "events_calendar" ON "events"("scheduled_date");

-- CreateIndex
CREATE INDEX "events_sponsor" ON "events"("sponsor_party_id");

-- CreateIndex
CREATE INDEX "audit_recent" ON "audit_log"("at" DESC);

-- CreateIndex
CREATE INDEX "audit_actor" ON "audit_log"("actor_id", "at" DESC);

-- CreateIndex
CREATE INDEX "audit_entity" ON "audit_log"("entity", "entity_ref");

-- CreateIndex
CREATE INDEX "notifications_recent" ON "notifications"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "party_roles" ADD CONSTRAINT "party_roles_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanththa_rates" ADD CONSTRAINT "sanththa_rates_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanththa_payments" ADD CONSTRAINT "sanththa_payments_sponsor_id_fkey" FOREIGN KEY ("sponsor_id") REFERENCES "sponsors"("party_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanththa_payments" ADD CONSTRAINT "sanththa_payments_collected_by_fkey" FOREIGN KEY ("collected_by") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanththa_payments" ADD CONSTRAINT "sanththa_payments_receipt_voucher_id_fkey" FOREIGN KEY ("receipt_voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_group_code_fkey" FOREIGN KEY ("group_code") REFERENCES "permission_groups"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_years" ADD CONSTRAINT "financial_years_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_default_party_id_fkey" FOREIGN KEY ("default_party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_default_fund_id_fkey" FOREIGN KEY ("default_fund_id") REFERENCES "funds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_default_project_id_fkey" FOREIGN KEY ("default_project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_default_party_id_fkey" FOREIGN KEY ("default_party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_default_account_id_fkey" FOREIGN KEY ("default_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_sequences" ADD CONSTRAINT "voucher_sequences_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_deposits" ADD CONSTRAINT "fixed_deposits_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_deposits" ADD CONSTRAINT "fixed_deposits_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_deposits" ADD CONSTRAINT "fixed_deposits_renewed_from_id_fkey" FOREIGN KEY ("renewed_from_id") REFERENCES "fixed_deposits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_slots" ADD CONSTRAINT "event_slots_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_type_sponsors" ADD CONSTRAINT "event_type_sponsors_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_type_sponsors" ADD CONSTRAINT "event_type_sponsors_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "event_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_type_sponsors" ADD CONSTRAINT "event_type_sponsors_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "event_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_sponsor_party_id_fkey" FOREIGN KEY ("sponsor_party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
