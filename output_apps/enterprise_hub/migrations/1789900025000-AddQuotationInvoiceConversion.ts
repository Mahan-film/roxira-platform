import { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRls } from './data/tenant-rls';

/**
 * T104 Quotation -> Invoice conversion:
 * - Adds `converted_invoice_id` foreign key on `erp_sales_quotations` pointing to `invoices(id)`
 * - Expands `status` check constraint to support 'EXPIRED'
 * - Ensures FORCE RLS on `erp_sales_quotations` and `erp_sales_quotation_lines`
 */
export class AddQuotationInvoiceConversion1789900025000 implements MigrationInterface {
  name = 'AddQuotationInvoiceConversion1789900025000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`SET LOCAL lock_timeout = '3s'`);
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
       CHECK ("status" IN ('DRAFT','SENT','ACCEPTED','REJECTED','CONVERTED','EXPIRED')) NOT VALID`,
    );
    await q.query(
      `ALTER TABLE "erp_sales_quotations" VALIDATE CONSTRAINT "CHK_erp_sales_quotations_status"`,
    );

    await enableTenantRls(q, 'erp_sales_quotations');
    await enableTenantRls(q, 'erp_sales_quotation_lines');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`SET LOCAL lock_timeout = '3s'`);
    const converted = await q.query(
      `SELECT count(*)::int AS count FROM "erp_sales_quotations" WHERE "converted_invoice_id" IS NOT NULL`,
    );
    if (converted && converted[0]?.count > 0) {
      throw new Error(
        `Cannot revert migration: ${converted[0].count} quotation(s) have converted invoices. Business records cannot be altered or deleted.`,
      );
    }
    const expired = await q.query(
      `SELECT count(*)::int AS count FROM "erp_sales_quotations" WHERE "status" = 'EXPIRED'`,
    );
    if (expired && expired[0]?.count > 0) {
      throw new Error(
        `Cannot revert migration: ${expired[0].count} quotation(s) have status 'EXPIRED'. Business records cannot be altered or deleted.`,
      );
    }
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
