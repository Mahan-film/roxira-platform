import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline for the tables that existed before the TypeORM migrations.
 *
 * Seven tables were created by the old Python layers (SQLAlchemy models in
 * archive/build_enterprise_core.py and raw DDL in output_apps/ecosystem_core),
 * not by a migration, but later migrations ALTER them or reference them:
 *
 *   fin_chart_of_accounts, fin_journal_entries   (1789050000000, 1789090000000, 1789160000000)
 *   erp_warehouses, erp_stock_items,
 *   inventory_fifo_batches                       (1789060000000, 1789170000000)
 *   crm_leads, contact_messages                  (1789070000000, 1789120000000, 1789140000000)
 *
 * so a fresh database could not be built from zero. This migration recreates
 * them in their original, pre-tenant shape (including the SQLAlchemy index
 * names `ix_<table>_<column>` that the tenant migrations drop) and runs first.
 *
 * Production safety: every table, with its indexes, is created inside a
 * `to_regclass(...) IS NULL` guard, and the `accounttype` enum only when it
 * is missing. On a database that already has these tables (production, and
 * the agent/e2e sandboxes cloned from its schema) nothing runs except the
 * catalog lookups. Indexes are deliberately not created separately with
 * IF NOT EXISTS: the tenant migrations dropped the global unique indexes
 * (e.g. `ix_crm_leads_email`) and they must not come back.
 *
 * `down` is a deliberate no-op: on production these tables predate the
 * migrations and hold data, so reverting the baseline must never drop them.
 */
export class LegacyBaseline1789000000000 implements MigrationInterface {
  name = 'LegacyBaseline1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'accounttype' AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."accounttype" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
        END IF;
      END $$
    `);

    // ------------------------------------------------------------------
    // Accounting (SQLAlchemy Account / JournalEntry)
    // ------------------------------------------------------------------
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.fin_chart_of_accounts') IS NULL THEN
          CREATE TABLE "fin_chart_of_accounts" (
            "id" SERIAL NOT NULL,
            "code" character varying(32) NOT NULL,
            "name" character varying(128) NOT NULL,
            "account_type" "public"."accounttype" NOT NULL,
            "currency" character varying(3) NOT NULL DEFAULT 'IRR',
            "balance" double precision NOT NULL DEFAULT 0,
            CONSTRAINT "fin_chart_of_accounts_pkey" PRIMARY KEY ("id")
          );
          CREATE UNIQUE INDEX "ix_fin_chart_of_accounts_code" ON "fin_chart_of_accounts" ("code");
          CREATE INDEX "ix_fin_chart_of_accounts_name" ON "fin_chart_of_accounts" ("name");
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.fin_journal_entries') IS NULL THEN
          CREATE TABLE "fin_journal_entries" (
            "id" SERIAL NOT NULL,
            "entry_number" character varying(64) NOT NULL,
            "date" TIMESTAMP NOT NULL DEFAULT now(),
            "description" text NOT NULL,
            "status" character varying(20) NOT NULL DEFAULT 'POSTED',
            CONSTRAINT "fin_journal_entries_pkey" PRIMARY KEY ("id")
          );
          CREATE UNIQUE INDEX "ix_fin_journal_entries_entry_number" ON "fin_journal_entries" ("entry_number");
        END IF;
      END $$
    `);

    // ------------------------------------------------------------------
    // Inventory (SQLAlchemy Warehouse / StockItem, ecosystem_core FIFO DDL)
    // ------------------------------------------------------------------
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.erp_warehouses') IS NULL THEN
          CREATE TABLE "erp_warehouses" (
            "id" SERIAL NOT NULL,
            "name" character varying(100) NOT NULL,
            "location_code" character varying(50) NOT NULL,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT "erp_warehouses_pkey" PRIMARY KEY ("id")
          );
          CREATE UNIQUE INDEX "ix_erp_warehouses_name" ON "erp_warehouses" ("name");
          CREATE INDEX "ix_erp_warehouses_location_code" ON "erp_warehouses" ("location_code");
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.erp_stock_items') IS NULL THEN
          CREATE TABLE "erp_stock_items" (
            "id" SERIAL NOT NULL,
            "sku" character varying(64) NOT NULL,
            "barcode" character varying(128) NOT NULL,
            "name" character varying(255) NOT NULL,
            "quantity" double precision NOT NULL DEFAULT 0,
            "batch_number" character varying(64),
            CONSTRAINT "erp_stock_items_pkey" PRIMARY KEY ("id")
          );
          CREATE UNIQUE INDEX "ix_erp_stock_items_sku" ON "erp_stock_items" ("sku");
          CREATE INDEX "ix_erp_stock_items_barcode" ON "erp_stock_items" ("barcode");
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.inventory_fifo_batches') IS NULL THEN
          CREATE TABLE "inventory_fifo_batches" (
            "id" SERIAL NOT NULL,
            "sku" character varying(100) NOT NULL,
            "batch_number" character varying(100) NOT NULL,
            "quantity_remaining" numeric(12,2) NOT NULL,
            "unit_purchase_cost" numeric(18,2) NOT NULL,
            "received_date" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "inventory_fifo_batches_pkey" PRIMARY KEY ("id")
          );
        END IF;
      END $$
    `);

    // ------------------------------------------------------------------
    // CRM (SQLAlchemy Lead, ecosystem_core contact_messages DDL)
    // ------------------------------------------------------------------
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.crm_leads') IS NULL THEN
          CREATE TABLE "crm_leads" (
            "id" SERIAL NOT NULL,
            "full_name" character varying(120) NOT NULL,
            "email" character varying(120) NOT NULL,
            "pipeline_stage" character varying(50) NOT NULL DEFAULT 'NEW',
            "notes" text,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
          );
          CREATE UNIQUE INDEX "ix_crm_leads_email" ON "crm_leads" ("email");
          CREATE INDEX "ix_crm_leads_full_name" ON "crm_leads" ("full_name");
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.contact_messages') IS NULL THEN
          CREATE TABLE "contact_messages" (
            "id" SERIAL NOT NULL,
            "sender_name" character varying(100) NOT NULL,
            "sender_phone" character varying(50) NOT NULL,
            "sender_email" character varying(100),
            "subject" character varying(255) NOT NULL,
            "message" text NOT NULL,
            "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
          );
        END IF;
      END $$
    `);
  }

  public async down(): Promise<void> {
    // Intentionally empty: see the class comment.
  }
}
