import { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRls } from './data/tenant-rls';

/**
 * T104 Quotation -> Invoice conversion:
 * - Adds `converted_invoice_id` foreign key on `erp_sales_quotations` pointing to `invoices(id)`
 * - Expands `status` check constraint to support 'EXPIRED'
 * - Ensures FORCE RLS on `erp_sales_quotations` and `erp_sales_quotation_lines`
 */
export class AddQuotationInvoiceConversion1789900004500 implements MigrationInterface {
  name = 'AddQuotationInvoiceConversion1789900004500';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "erp_sales_quotations"
       ADD COLUMN IF NOT EXISTS "converted_invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL`,
    );

    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_sales_quotations_tenant_invoice"
       ON "erp_sales_quotations" ("tenant_id", "converted_invoice_id")`,
    );

    await q.query(
      `ALTER TABLE "erp_sales_quotations" DROP CONSTRAINT IF EXISTS "CHK_erp_sales_quotations_status"`,
    );

    await q.query(
      `ALTER TABLE "erp_sales_quotations"
       ADD CONSTRAINT "CHK_erp_sales_quotations_status"
       CHECK ("status" IN ('DRAFT','SENT','ACCEPTED','REJECTED','CONVERTED','EXPIRED'))`,
    );

    await enableTenantRls(q, 'erp_sales_quotations');
    await enableTenantRls(q, 'erp_sales_quotation_lines');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_erp_sales_quotations_tenant_invoice"`);
    await q.query(
      `ALTER TABLE "erp_sales_quotations" DROP COLUMN IF EXISTS "converted_invoice_id"`,
    );
    await q.query(
      `ALTER TABLE "erp_sales_quotations" DROP CONSTRAINT IF EXISTS "CHK_erp_sales_quotations_status"`,
    );
    await q.query(
      `ALTER TABLE "erp_sales_quotations"
       ADD CONSTRAINT "CHK_erp_sales_quotations_status"
       CHECK ("status" IN ('DRAFT','SENT','ACCEPTED','REJECTED','CONVERTED'))`,
    );
  }
}
