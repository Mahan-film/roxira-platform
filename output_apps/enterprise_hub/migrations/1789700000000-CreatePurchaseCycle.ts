import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Purchase cycle tables (#227 T2): settings, request, order and goods receipt, all tenant scoped.
 *
 * Money columns are bigint minor units (rial x 100); quantities are bigint hundredths. Every table
 * carries `tenant_id` and is created with FORCE row-level security in this migration. Rows are only
 * reached through PurchaseRepository, which runs inside TenantScope. Purely additive.
 *
 * Revert: `down()` disables the policies and drops the six tables (purchase documents are lost).
 */
export class CreatePurchaseCycle1789700000000 implements MigrationInterface {
  name = 'CreatePurchaseCycle1789700000000';

  private readonly tables = [
    'erp_purchase_settings',
    'erp_purchase_requests',
    'erp_purchase_orders',
    'erp_purchase_order_lines',
    'erp_goods_receipts',
    'erp_goods_receipt_lines',
  ];

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_purchase_settings" (
        "tenant_id" uuid NOT NULL,
        "over_receipt_tolerance_bp" int NOT NULL DEFAULT 0,
        "price_tolerance_bp" int NOT NULL DEFAULT 0,
        "price_tolerance_abs" bigint NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_erp_purchase_settings" PRIMARY KEY ("tenant_id"),
        CONSTRAINT "CHK_erp_purchase_settings_over_receipt" CHECK ("over_receipt_tolerance_bp" >= 0),
        CONSTRAINT "CHK_erp_purchase_settings_price_bp" CHECK ("price_tolerance_bp" >= 0),
        CONSTRAINT "CHK_erp_purchase_settings_price_abs" CHECK ("price_tolerance_abs" >= 0)
      )`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_purchase_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "number" varchar(32) NOT NULL,
        "status" varchar(16) NOT NULL,
        "requested_by" varchar(64) NOT NULL,
        "lines" jsonb NOT NULL,
        "order_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_erp_purchase_requests" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_erp_purchase_requests_tenant_number" UNIQUE ("tenant_id", "number")
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_purchase_requests_tenant_status" ON "erp_purchase_requests" ("tenant_id", "status", "created_at")`,
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_purchase_orders" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "number" varchar(32) NOT NULL,
        "supplier_code" varchar(64) NOT NULL,
        "status" varchar(24) NOT NULL,
        "warehouse_id" int,
        "request_id" uuid,
        "order_date" varchar(10) NOT NULL,
        "approved_by" varchar(64),
        "approved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_erp_purchase_orders" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_erp_purchase_orders_tenant_number" UNIQUE ("tenant_id", "number")
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_purchase_orders_tenant_status" ON "erp_purchase_orders" ("tenant_id", "status", "created_at")`,
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_purchase_order_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "line_no" int NOT NULL,
        "sku" varchar(64) NOT NULL,
        "quantity" bigint NOT NULL,
        "unit_price" bigint NOT NULL,
        "received_quantity" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_erp_purchase_order_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_erp_purchase_order_lines_order" FOREIGN KEY ("order_id")
          REFERENCES "erp_purchase_orders" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_erp_purchase_order_lines_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_erp_purchase_order_lines_unit_price" CHECK ("unit_price" >= 0),
        CONSTRAINT "CHK_erp_purchase_order_lines_received" CHECK ("received_quantity" >= 0)
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_purchase_order_lines_tenant_order" ON "erp_purchase_order_lines" ("tenant_id", "order_id")`,
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_goods_receipts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "number" varchar(32) NOT NULL,
        "order_id" uuid,
        "supplier_code" varchar(64) NOT NULL,
        "received_at" timestamptz NOT NULL DEFAULT now(),
        "received_by" varchar(64) NOT NULL,
        "idempotency_key" varchar(128),
        "total_value" bigint NOT NULL DEFAULT 0,
        "journal_entry_id" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_erp_goods_receipts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_erp_goods_receipts_order" FOREIGN KEY ("order_id")
          REFERENCES "erp_purchase_orders" ("id"),
        CONSTRAINT "UQ_erp_goods_receipts_tenant_number" UNIQUE ("tenant_id", "number"),
        CONSTRAINT "UQ_erp_goods_receipts_tenant_idempotency" UNIQUE ("tenant_id", "idempotency_key")
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_goods_receipts_tenant_order" ON "erp_goods_receipts" ("tenant_id", "order_id")`,
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_goods_receipt_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "receipt_id" uuid NOT NULL,
        "order_line_id" uuid NOT NULL,
        "sku" varchar(64) NOT NULL,
        "quantity" bigint NOT NULL,
        "unit_cost" bigint NOT NULL,
        "value" bigint NOT NULL,
        "weight" bigint,
        "fifo_batch_id" int,
        CONSTRAINT "PK_erp_goods_receipt_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_erp_goods_receipt_lines_receipt" FOREIGN KEY ("receipt_id")
          REFERENCES "erp_goods_receipts" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_erp_goods_receipt_lines_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_erp_goods_receipt_lines_unit_cost" CHECK ("unit_cost" >= 0),
        CONSTRAINT "CHK_erp_goods_receipt_lines_value" CHECK ("value" >= 0),
        CONSTRAINT "CHK_erp_goods_receipt_lines_weight" CHECK ("weight" IS NULL OR "weight" >= 0)
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_goods_receipt_lines_tenant_receipt" ON "erp_goods_receipt_lines" ("tenant_id", "receipt_id")`,
    );

    for (const table of this.tables) {
      await enableTenantRls(q, table);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...this.tables].reverse()) {
      await disableTenantRls(q, table);
    }
    await q.query(`DROP TABLE IF EXISTS "erp_goods_receipt_lines"`);
    await q.query(`DROP TABLE IF EXISTS "erp_goods_receipts"`);
    await q.query(`DROP TABLE IF EXISTS "erp_purchase_order_lines"`);
    await q.query(`DROP TABLE IF EXISTS "erp_purchase_orders"`);
    await q.query(`DROP TABLE IF EXISTS "erp_purchase_requests"`);
    await q.query(`DROP TABLE IF EXISTS "erp_purchase_settings"`);
  }
}