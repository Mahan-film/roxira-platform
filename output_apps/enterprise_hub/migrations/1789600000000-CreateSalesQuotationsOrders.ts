import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Sales cycle, first slice: quotations and sales orders (issue #509, T1).
 *
 * Four tenant tables, each with `tenant_id` and FORCE row-level security created in the same
 * migration. Quotations are priced documents that are sent, accepted and converted into an order;
 * orders are the confirmed intent to sell from a warehouse. Neither carries VAT: the statutory VAT
 * is posted later by the invoice. All amounts are exact numeric(18,2), quantities numeric(12,2);
 * the repositories map them as strings and never through a float. Purely additive.
 */
export class CreateSalesQuotationsOrders1789600000000 implements MigrationInterface {
  name = 'CreateSalesQuotationsOrders1789600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE IF NOT EXISTS "erp_sales_quotations" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "number" character varying(40) NOT NULL,
        "party_code" character varying(64) NOT NULL,
        "quote_date" date NOT NULL,
        "valid_until" date,
        "status" character varying(12) NOT NULL DEFAULT 'DRAFT',
        "note" character varying(512),
        "total_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "created_by" character varying(64),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_erp_sales_quotations_status" CHECK ("status" IN ('DRAFT','SENT','ACCEPTED','REJECTED','CONVERTED'))
      )`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_erp_sales_quotations_tenant_number" ON "erp_sales_quotations" ("tenant_id", "number")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_sales_quotations_tenant_party_status" ON "erp_sales_quotations" ("tenant_id", "party_code", "status")`,
    );
    await enableTenantRls(q, 'erp_sales_quotations');

    await q.query(
      `CREATE TABLE IF NOT EXISTS "erp_sales_quotation_lines" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "quotation_id" integer NOT NULL REFERENCES "erp_sales_quotations"("id") ON DELETE CASCADE,
        "line_no" integer NOT NULL,
        "item_id" integer NOT NULL,
        "description" character varying(255),
        "quantity" numeric(12,2) NOT NULL,
        "unit_price" numeric(18,2) NOT NULL,
        "discount" numeric(18,2) NOT NULL DEFAULT 0,
        "line_total" numeric(18,2) NOT NULL,
        CONSTRAINT "CHK_erp_sales_quotation_lines_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_erp_sales_quotation_lines_unit_price" CHECK ("unit_price" >= 0),
        CONSTRAINT "CHK_erp_sales_quotation_lines_discount" CHECK ("discount" >= 0)
      )`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_erp_sales_quotation_lines_quotation_no" ON "erp_sales_quotation_lines" ("quotation_id", "line_no")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_sales_quotation_lines_tenant_quotation" ON "erp_sales_quotation_lines" ("tenant_id", "quotation_id")`,
    );
    await enableTenantRls(q, 'erp_sales_quotation_lines');

    await q.query(
      `CREATE TABLE IF NOT EXISTS "erp_sales_orders" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "number" character varying(40) NOT NULL,
        "party_code" character varying(64) NOT NULL,
        "quotation_id" integer REFERENCES "erp_sales_quotations"("id"),
        "warehouse_id" integer NOT NULL,
        "order_date" date NOT NULL,
        "promised_date" date,
        "status" character varying(12) NOT NULL DEFAULT 'DRAFT',
        "note" character varying(512),
        "total_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "created_by" character varying(64),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_erp_sales_orders_status" CHECK ("status" IN ('DRAFT','CONFIRMED','CANCELLED'))
      )`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_erp_sales_orders_tenant_number" ON "erp_sales_orders" ("tenant_id", "number")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_sales_orders_tenant_party_status" ON "erp_sales_orders" ("tenant_id", "party_code", "status")`,
    );
    await enableTenantRls(q, 'erp_sales_orders');

    await q.query(
      `CREATE TABLE IF NOT EXISTS "erp_sales_order_lines" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "order_id" integer NOT NULL REFERENCES "erp_sales_orders"("id") ON DELETE CASCADE,
        "line_no" integer NOT NULL,
        "item_id" integer NOT NULL,
        "description" character varying(255),
        "quantity" numeric(12,2) NOT NULL,
        "unit_price" numeric(18,2) NOT NULL,
        "discount" numeric(18,2) NOT NULL DEFAULT 0,
        "line_total" numeric(18,2) NOT NULL,
        "delivered_quantity" numeric(12,2) NOT NULL DEFAULT 0,
        "invoiced_quantity" numeric(12,2) NOT NULL DEFAULT 0,
        CONSTRAINT "CHK_erp_sales_order_lines_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_erp_sales_order_lines_unit_price" CHECK ("unit_price" >= 0),
        CONSTRAINT "CHK_erp_sales_order_lines_discount" CHECK ("discount" >= 0),
        CONSTRAINT "CHK_erp_sales_order_lines_delivered" CHECK ("delivered_quantity" >= 0 AND "delivered_quantity" <= "quantity"),
        CONSTRAINT "CHK_erp_sales_order_lines_invoiced" CHECK ("invoiced_quantity" >= 0 AND "invoiced_quantity" <= "quantity")
      )`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_erp_sales_order_lines_order_no" ON "erp_sales_order_lines" ("order_id", "line_no")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_sales_order_lines_tenant_order" ON "erp_sales_order_lines" ("tenant_id", "order_id")`,
    );
    await enableTenantRls(q, 'erp_sales_order_lines');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'erp_sales_order_lines');
    await q.query(`DROP TABLE IF EXISTS "erp_sales_order_lines"`);
    await disableTenantRls(q, 'erp_sales_orders');
    await q.query(`DROP TABLE IF EXISTS "erp_sales_orders"`);
    await disableTenantRls(q, 'erp_sales_quotation_lines');
    await q.query(`DROP TABLE IF EXISTS "erp_sales_quotation_lines"`);
    await disableTenantRls(q, 'erp_sales_quotations');
    await q.query(`DROP TABLE IF EXISTS "erp_sales_quotations"`);
  }
}
