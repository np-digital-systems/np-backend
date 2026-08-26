-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin', 'accountant', 'cashier', 'user');

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
CREATE TYPE "financial_year_status" AS ENUM ('open', 'closed', 'upcoming');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('create', 'update', 'delete', 'approve', 'reject', 'post', 'login', 'logout', 'permission-change');

-- CreateEnum
CREATE TYPE "notification_category" AS ENUM ('Approval', 'Accounting', 'Event', 'Sanththa', 'Banking', 'Fixed Deposit', 'Financial Year', 'User Administration', 'Security', 'System');

-- CreateEnum
CREATE TYPE "notification_priority" AS ENUM ('Information', 'Reminder', 'Warning', 'Critical');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name_ta" TEXT NOT NULL,
    "full_name" TEXT,
    "email" CITEXT,
    "password_hash" TEXT,
    "phone" TEXT,
    "address" TEXT NOT NULL DEFAULT '',
    "role" "user_role" NOT NULL DEFAULT 'user',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "member_no" TEXT,
    "joined_on" DATE,
    "subscribes" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
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
    "code" "user_role" NOT NULL,
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
    "role_code" "user_role" NOT NULL,
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
    "account_id" INTEGER NOT NULL,
    "fund_id" INTEGER NOT NULL,
    "project_id" INTEGER,
    "mode" "payment_mode" NOT NULL,
    "bank_account_id" INTEGER,
    "cheque_no" TEXT,
    "party" TEXT NOT NULL,
    "manual_voucher_no" TEXT,
    "event_ref" TEXT,
    "event_type_id" INTEGER,
    "event_id" INTEGER,
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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_type_sponsors" (
    "id" SERIAL NOT NULL,
    "event_type_id" INTEGER NOT NULL,
    "instance_identifier" SMALLINT NOT NULL,
    "custom_instance_name" TEXT,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_type_sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" SERIAL NOT NULL,
    "event_type_id" INTEGER NOT NULL,
    "instance_identifier" SMALLINT NOT NULL,
    "custom_instance_name" TEXT,
    "scheduled_date" DATE NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6),
    "sponsor_id" UUID,
    "notes" TEXT,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sanththa_payments" (
    "id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
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
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "actor_name" TEXT NOT NULL,
    "actor_role" "user_role" NOT NULL,
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
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_member_no_key" ON "users"("member_no");

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
CREATE UNIQUE INDEX "funds_name_ta_key" ON "funds"("name_ta");

-- CreateIndex
CREATE INDEX "projects_fund" ON "projects"("fund_id", "status");

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
CREATE INDEX "vouchers_party" ON "vouchers" USING GIN ("party" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ledger_account_date" ON "ledger_entries"("account_id", "date");

-- CreateIndex
CREATE INDEX "ledger_fund_date" ON "ledger_entries"("fund_id", "date");

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
CREATE INDEX "sponsors_by_user" ON "event_type_sponsors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "one_sponsor_per_slot" ON "event_type_sponsors"("event_type_id", "instance_identifier");

-- CreateIndex
CREATE INDEX "events_calendar" ON "events"("scheduled_date");

-- CreateIndex
CREATE INDEX "events_sponsor" ON "events"("sponsor_id");

-- CreateIndex
CREATE UNIQUE INDEX "one_payment_per_receipt" ON "sanththa_payments"("receipt_voucher_id");

-- CreateIndex
CREATE INDEX "payments_year" ON "sanththa_payments"("year");

-- CreateIndex
CREATE INDEX "payments_member" ON "sanththa_payments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "one_payment_per_member_per_year" ON "sanththa_payments"("user_id", "year");

-- CreateIndex
CREATE INDEX "audit_recent" ON "audit_log"("at" DESC);

-- CreateIndex
CREATE INDEX "audit_actor" ON "audit_log"("actor_id", "at" DESC);

-- CreateIndex
CREATE INDEX "audit_entity" ON "audit_log"("entity", "entity_ref");

-- CreateIndex
CREATE INDEX "notifications_recent" ON "notifications"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_group_code_fkey" FOREIGN KEY ("group_code") REFERENCES "permission_groups"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_years" ADD CONSTRAINT "financial_years_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "event_type_sponsors" ADD CONSTRAINT "event_type_sponsors_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_type_sponsors" ADD CONSTRAINT "event_type_sponsors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_sponsor_id_fkey" FOREIGN KEY ("sponsor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanththa_payments" ADD CONSTRAINT "sanththa_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanththa_payments" ADD CONSTRAINT "sanththa_payments_collected_by_fkey" FOREIGN KEY ("collected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanththa_payments" ADD CONSTRAINT "sanththa_payments_receipt_voucher_id_fkey" FOREIGN KEY ("receipt_voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
