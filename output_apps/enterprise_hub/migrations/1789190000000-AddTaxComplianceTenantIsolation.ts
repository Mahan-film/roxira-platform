import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * جداسازی مستأجر (Multi-Tenant) برای ماژول Tax Compliance — Wave 5.
 *
 * جداول `tax_signing_keys` و `tax_invoice_signatures` پیش‌تر هیچ ستون مستأجری
 * نداشتند و خواندن/نوشتن میان همه سازمان‌ها مشترک بود. این Migration:
 *   • ستون `tenant_id` را به هر دو جدول اضافه و ردیف‌های موجود را با مستأجر
 *     پیش‌فرض پر می‌کند؛
 *   • ستون را NOT NULL می‌کند؛
 *   • ایندکس‌های ترکیبی مسیر کوئری مستأجری را می‌سازد؛
 *   • ایندکس یکتای سراسری `tax_signing_keys.key_id` و ایندکس‌های یکتای سراسری
 *     `tax_invoice_signatures.invoice_id` و `.tax_id` را با نام واقعی‌شان حذف و
 *     به ایندکس‌های یکتای ترکیبی `(tenant_id, key_id)`, `(tenant_id, invoice_id)`
 *     و `(tenant_id, tax_id)` تبدیل می‌کند تا دو سازمان بتوانند کلید/صورتحساب
 *     یکسان داشته باشند.
 *   • برای تضمین «دقیقاً یک کلید فعال در هر سازمان» یک ایندکس یکتای جزئی
 *     `(tenant_id) WHERE is_active` می‌سازد.
 *
 * طبق Rule #4 AGENTS.md (Contract-First Synchronization) این تغییر صریحاً از
 * طریق Migration اعمال می‌شود و هرگز به synchronize=true تکیه نمی‌کنیم.
 */
export class AddTaxComplianceTenantIsolation1789190000000
  implements MigrationInterface
{
  name = 'AddTaxComplianceTenantIsolation1789190000000';

  /** شناسه ثابت مستأجر پیش‌فرض (همان مقدار backfill در 1789120000000). */
  private readonly defaultTenantId = '00000000-0000-0000-0000-000000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // tax_signing_keys — افزودن، پرکردن و الزامی‌کردن ستون مستأجر
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "tax_signing_keys" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "tax_signing_keys" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL`,
      [this.defaultTenantId],
    );
    await queryRunner.query(
      `ALTER TABLE "tax_signing_keys" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );

    // ایندکس مسیر کوئری مستأجری + گسترش یکتایی سراسری key_id
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tax_signing_keys_tenant_created_at" ON "tax_signing_keys" ("tenant_id", "created_at")`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tax_signing_keys_key_id"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tax_signing_keys_tenant_key_id" ON "tax_signing_keys" ("tenant_id", "key_id")`,
    );
    // هر سازمان حداکثر یک کلید فعال دارد.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tax_signing_keys_tenant_active" ON "tax_signing_keys" ("tenant_id") WHERE "is_active"`,
    );

    // ------------------------------------------------------------------
    // tax_invoice_signatures — افزودن، پرکردن و الزامی‌کردن ستون مستأجر
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "tax_invoice_signatures" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "tax_invoice_signatures" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL`,
      [this.defaultTenantId],
    );
    await queryRunner.query(
      `ALTER TABLE "tax_invoice_signatures" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );

    // ایندکس‌های مسیر کوئری مستأجری
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tax_invoice_signatures_tenant_created_at" ON "tax_invoice_signatures" ("tenant_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tax_invoice_signatures_tenant_status" ON "tax_invoice_signatures" ("tenant_id", "status")`,
    );

    // گسترش یکتایی‌های سراسری به ترکیب (tenant_id, ...)
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tax_invoice_signatures_invoice_id"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tax_invoice_signatures_tenant_invoice_id" ON "tax_invoice_signatures" ("tenant_id", "invoice_id")`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tax_invoice_signatures_tax_id"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tax_invoice_signatures_tenant_tax_id" ON "tax_invoice_signatures" ("tenant_id", "tax_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // tax_invoice_signatures — بازگرداندن یکتایی‌های سراسری و حذف ستون
    // ------------------------------------------------------------------
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tax_invoice_signatures_tenant_tax_id"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tax_invoice_signatures_tax_id" ON "tax_invoice_signatures" ("tax_id")`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tax_invoice_signatures_tenant_invoice_id"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tax_invoice_signatures_invoice_id" ON "tax_invoice_signatures" ("invoice_id")`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tax_invoice_signatures_tenant_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tax_invoice_signatures_tenant_created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tax_invoice_signatures" DROP COLUMN IF EXISTS "tenant_id"`,
    );

    // ------------------------------------------------------------------
    // tax_signing_keys — بازگرداندن یکتایی سراسری و حذف ستون
    // ------------------------------------------------------------------
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tax_signing_keys_tenant_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tax_signing_keys_tenant_key_id"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tax_signing_keys_key_id" ON "tax_signing_keys" ("key_id")`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tax_signing_keys_tenant_created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tax_signing_keys" DROP COLUMN IF EXISTS "tenant_id"`,
    );
  }
}
