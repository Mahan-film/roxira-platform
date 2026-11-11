import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Migration 1789900002800: Production Bill of Materials (BOM) and Production Orders (#764 / T83).
 * Multi-level BOM with waste percentage, production orders issuing raw materials at FIFO cost
 * and receiving finished goods at summed cost.
 * Enforces strict FORCE RLS on all tenant tables using standard enableTenantRls helper.
 */
export class CreateProductionBomAndOrders1789900002800 implements MigrationInterface {
  name = 'CreateProductionBomAndOrders1789900002800';

  public async up(q: QueryRunner): Promise<void> {
    // 1. erp_bom_headers table
    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_bom_headers" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "bom_code" varchar(64) NOT NULL,
        "name" varchar(255) NOT NULL,
        "finished_item_sku" varchar(100) NOT NULL,
        "output_quantity" numeric(12, 3) NOT NULL DEFAULT 1.000,
        "version" int NOT NULL DEFAULT 1,
        "is_active" boolean NOT NULL DEFAULT true,
        "notes" text NULL,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CHK_erp_bom_headers_qty" CHECK ("output_quantity" > 0),
        CONSTRAINT "CHK_erp_bom_headers_version" CHECK ("version" >= 1)
      )
    `);

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_erp_bom_headers_tenant_code"
      ON "erp_bom_headers" ("tenant_id", "bom_code")
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_erp_bom_headers_tenant_sku"
      ON "erp_bom_headers" ("tenant_id", "finished_item_sku")
    `);

    await enableTenantRls(q, 'erp_bom_headers');

    // 2. erp_bom_items table (multi-level via optional sub_bom_id)
    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_bom_items" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "bom_id" int NOT NULL REFERENCES "erp_bom_headers"("id") ON DELETE CASCADE,
        "component_sku" varchar(100) NOT NULL,
        "sub_bom_id" int NULL REFERENCES "erp_bom_headers"("id") ON DELETE RESTRICT,
        "quantity" numeric(12, 3) NOT NULL,
        "waste_percent" numeric(5, 2) NOT NULL DEFAULT 0.00,
        "notes" varchar(255) NULL,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CHK_erp_bom_items_qty" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_erp_bom_items_waste" CHECK ("waste_percent" >= 0 AND "waste_percent" <= 100)
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_erp_bom_items_tenant_bom"
      ON "erp_bom_items" ("tenant_id", "bom_id")
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_erp_bom_items_tenant_component"
      ON "erp_bom_items" ("tenant_id", "component_sku")
    `);

    await enableTenantRls(q, 'erp_bom_items');

    // 3. erp_production_orders table
    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_production_orders" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "order_number" varchar(64) NOT NULL,
        "bom_id" int NOT NULL REFERENCES "erp_bom_headers"("id"),
        "finished_sku" varchar(100) NOT NULL,
        "warehouse_id" int NULL,
        "planned_quantity" numeric(12, 3) NOT NULL,
        "completed_quantity" numeric(12, 3) NOT NULL DEFAULT 0.000,
        "status" varchar(32) NOT NULL DEFAULT 'draft',
        "total_cost_minor" bigint NOT NULL DEFAULT 0,
        "unit_cost_minor" bigint NOT NULL DEFAULT 0,
        "voucher_id" int NULL,
        "notes" text NULL,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CHK_erp_production_orders_status" CHECK ("status" IN ('draft', 'in_progress', 'completed', 'cancelled')),
        CONSTRAINT "CHK_erp_production_orders_planned_qty" CHECK ("planned_quantity" > 0),
        CONSTRAINT "CHK_erp_production_orders_completed_qty" CHECK ("completed_quantity" >= 0),
        CONSTRAINT "CHK_erp_production_orders_total_cost" CHECK ("total_cost_minor" >= 0),
        CONSTRAINT "CHK_erp_production_orders_unit_cost" CHECK ("unit_cost_minor" >= 0)
      )
    `);

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_erp_production_orders_tenant_num"
      ON "erp_production_orders" ("tenant_id", "order_number")
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_erp_production_orders_tenant_status"
      ON "erp_production_orders" ("tenant_id", "status")
    `);

    await enableTenantRls(q, 'erp_production_orders');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'erp_production_orders');
    await q.query('DROP TABLE IF EXISTS "erp_production_orders"');

    await disableTenantRls(q, 'erp_bom_items');
    await q.query('DROP TABLE IF EXISTS "erp_bom_items"');

    await disableTenantRls(q, 'erp_bom_headers');
    await q.query('DROP TABLE IF EXISTS "erp_bom_headers"');
  }
}
