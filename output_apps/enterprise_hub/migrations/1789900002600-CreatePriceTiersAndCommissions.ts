import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Migration 1789900002600: Price tiers per customer group & sales rep commissions (#230 / T74).
 * Enforces strict FORCE RLS on both tenant-isolated tables using standard enableTenantRls helper.
 */
export class CreatePriceTiersAndCommissions1789900002600 implements MigrationInterface {
  name = 'CreatePriceTiersAndCommissions1789900002600';

  public async up(q: QueryRunner): Promise<void> {
    // 1. erp_parties customer_group column
    await q.query(`
      ALTER TABLE "erp_parties"
      ADD COLUMN IF NOT EXISTS "customer_group" varchar(32) NOT NULL DEFAULT 'consumer';

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_erp_parties_customer_group'
        ) THEN
          ALTER TABLE "erp_parties"
          ADD CONSTRAINT "CHK_erp_parties_customer_group"
          CHECK ("customer_group" IN ('consumer', 'wholesale', 'partner'));
        END IF;
      END $$;
    `);

    // 2. erp_price_tiers table
    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_price_tiers" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "sku" varchar(64) NOT NULL,
        "customer_group" varchar(32) NOT NULL,
        "unit_price" bigint NOT NULL,
        "discount_percent" numeric(5, 2) NOT NULL DEFAULT 0,
        "effective_from" date NOT NULL DEFAULT CURRENT_DATE,
        "effective_to" date NULL,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CHK_erp_price_tiers_price" CHECK ("unit_price" >= 0),
        CONSTRAINT "CHK_erp_price_tiers_discount" CHECK ("discount_percent" >= 0 AND "discount_percent" <= 100),
        CONSTRAINT "CHK_erp_price_tiers_group" CHECK ("customer_group" IN ('consumer', 'wholesale', 'partner')),
        CONSTRAINT "CHK_erp_price_tiers_dates" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_erp_price_tiers_lookup"
      ON "erp_price_tiers" ("tenant_id", "sku", "customer_group")
    `);

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_erp_price_tiers_window"
      ON "erp_price_tiers" ("tenant_id", "sku", "customer_group", "effective_from")
    `);

    await enableTenantRls(q, 'erp_price_tiers');

    // 3. erp_sales_commission_policies table
    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_sales_commission_policies" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "category" varchar(64) NOT NULL,
        "commission_rate" numeric(5, 2) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CHK_erp_sales_comm_rate" CHECK ("commission_rate" >= 0 AND "commission_rate" <= 100)
      )
    `);

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_erp_sales_comm_tenant_category"
      ON "erp_sales_commission_policies" ("tenant_id", "category")
    `);

    await enableTenantRls(q, 'erp_sales_commission_policies');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'erp_sales_commission_policies');
    await q.query(`DROP TABLE IF EXISTS "erp_sales_commission_policies"`);

    await disableTenantRls(q, 'erp_price_tiers');
    await q.query(`DROP INDEX IF EXISTS "UQ_erp_price_tiers_window"`);
    await q.query(`DROP TABLE IF EXISTS "erp_price_tiers"`);

    await q.query(`
      ALTER TABLE "erp_parties" DROP CONSTRAINT IF EXISTS "CHK_erp_parties_customer_group";
      ALTER TABLE "erp_parties" DROP COLUMN IF EXISTS "customer_group";
    `);
  }
}
