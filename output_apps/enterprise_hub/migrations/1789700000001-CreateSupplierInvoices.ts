import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Supplier invoice and its 3-way match lines (#227 T2), tenant scoped.
 *
 * Money columns are bigint minor units (rial x 100); quantities are bigint hundredths. The invoice
 * points at a purchase order and each line at a goods receipt line; `supplier_ref` is the supplier's
 * own invoice number and is unique per tenant and supplier (a duplicate is a double booking).
 * Both tables carry `tenant_id` and are created with FORCE row-level security. Purely additive.
 *
 * Revert: `down()` disables the policies and drops the two tables (supplier invoices are lost).
 */
export class CreateSupplierInvoices1789700000001 implements MigrationInterface {
  name = 'CreateSupplierInvoices1789700000001';

  private readonly tables = ['erp_supplier_invoices', 'erp_supplier_invoice_lines'];

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_supplier_invoices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "number" varchar(32) NOT NULL,
        "order_id" uuid,
        "supplier_code" varchar(64) NOT NULL,
        "supplier_ref" varchar(64) NOT NULL,
        "invoice_date" varchar(10) NOT NULL,
        "status" varchar(16) NOT NULL,
        "accepted" boolean NOT NULL DEFAULT false,
        "accepted_by" varchar(64),
        "accepted_at" timestamptz,
        "accept_note" text,
        "created_by" varchar(64) NOT NULL,
        "vat" bigint NOT NULL DEFAULT 0,
        "subtotal" bigint,
        "total" bigint,
        "journal_entry_id" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_erp_supplier_invoices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_erp_supplier_invoices_order" FOREIGN KEY ("order_id")
          REFERENCES "erp_purchase_orders" ("id"),
        CONSTRAINT "UQ_erp_supplier_invoices_tenant_number" UNIQUE ("tenant_id", "number"),
        CONSTRAINT "UQ_erp_supplier_invoices_tenant_supplier_ref" UNIQUE ("tenant_id", "supplier_code", "supplier_ref"),
        CONSTRAINT "CHK_erp_supplier_invoices_status" CHECK ("status" IN ('HELD', 'MATCHED', 'POSTED')),
        CONSTRAINT "CHK_erp_supplier_invoices_vat" CHECK ("vat" >= 0)
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_supplier_invoices_tenant_order" ON "erp_supplier_invoices" ("tenant_id", "order_id", "created_at")`,
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "erp_supplier_invoice_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "invoice_id" uuid NOT NULL,
        "receipt_line_id" uuid NOT NULL,
        "sku" varchar(64) NOT NULL,
        "quantity" bigint NOT NULL,
        "unit_price" bigint NOT NULL,
        "order_value" bigint NOT NULL,
        "invoice_value" bigint NOT NULL,
        "price_difference" bigint NOT NULL,
        "match_status" varchar(32) NOT NULL,
        CONSTRAINT "PK_erp_supplier_invoice_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_erp_supplier_invoice_lines_invoice" FOREIGN KEY ("invoice_id")
          REFERENCES "erp_supplier_invoices" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_erp_supplier_invoice_lines_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_erp_supplier_invoice_lines_unit_price" CHECK ("unit_price" >= 0)
      )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_supplier_invoice_lines_tenant_invoice" ON "erp_supplier_invoice_lines" ("tenant_id", "invoice_id")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_supplier_invoice_lines_tenant_receipt_line" ON "erp_supplier_invoice_lines" ("tenant_id", "receipt_line_id")`,
    );

    for (const table of this.tables) {
      await enableTenantRls(q, table);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...this.tables].reverse()) {
      await disableTenantRls(q, table);
    }
    await q.query(`DROP TABLE IF EXISTS "erp_supplier_invoice_lines"`);
    await q.query(`DROP TABLE IF EXISTS "erp_supplier_invoices"`);
  }
}