import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * جداسازی مستأجر (Multi-Tenant) برای ماژول Invoicing — Wave 1.
 *
 * جدول `invoices` پیش‌تر هیچ ستون مستأجری نداشت و خواندن/نوشتن میان همه
 * سازمان‌ها مشترک بود. این Migration:
 *   • ستون `tenant_id` را اضافه و ردیف‌های موجود را با مستأجر پیش‌فرض پر می‌کند؛
 *   • ستون را NOT NULL می‌کند؛
 *   • ایندکس‌های ترکیبی لازم برای کوئری‌های مستأجری را می‌سازد؛
 *   • ایندکس یکتای سراسری `taxInvoiceNumber` را به ایندکس یکتای ترکیبی
 *     `(tenant_id, "taxInvoiceNumber")` تبدیل می‌کند تا دو سازمان بتوانند
 *     شماره صورتحساب یکسان داشته باشند.
 *
 * این Migration فقط از طریق PR بازبینی‌شده اعمال می‌شود و هرگز به
 * synchronize=true تکیه نمی‌کند (Rule #4 - AGENTS.md).
 */
export class AddInvoicingTenantIsolation1789150000000
  implements MigrationInterface
{
  name = 'AddInvoicingTenantIsolation1789150000000';

  /** شناسه ثابت مستأجر پیش‌فرض (همان مقدار backfill در 1789120000000). */
  private readonly defaultTenantId = '00000000-0000-0000-0000-000000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // invoices — افزودن، پرکردن و الزامی‌کردن ستون مستأجر
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "invoices" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL`,
      [this.defaultTenantId],
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );

    // ------------------------------------------------------------------
    // ایندکس‌های مسیر کوئری مستأجری
    // ------------------------------------------------------------------
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoices_tenant_createdAt" ON "invoices" ("tenant_id", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoices_tenant_status" ON "invoices" ("tenant_id", "status")`,
    );

    // ------------------------------------------------------------------
    // گسترش یکتایی سراسری شماره صورتحساب به ترکیب (tenant_id, taxInvoiceNumber)
    // ------------------------------------------------------------------
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_invoices_taxInvoiceNumber"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_invoices_tenant_taxInvoiceNumber" ON "invoices" ("tenant_id", "taxInvoiceNumber")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // بازگرداندن یکتایی سراسری شماره صورتحساب
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_invoices_tenant_taxInvoiceNumber"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_invoices_taxInvoiceNumber" ON "invoices" ("taxInvoiceNumber")`,
    );

    // حذف ایندکس‌های مستأجری و ستون
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_invoices_tenant_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_invoices_tenant_createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "tenant_id"`,
    );
  }
}
