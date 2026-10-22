import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * فاز ۲a صورتحساب: مشتری CRM، وضعیت پرداخت و VAT قابل تنظیم.
 *
 * تغییرات:
 *   • افزودن مقدار `PAID` به enum وضعیت صورتحساب.
 *   • ستون `customer_id` برای پیوند صورتحساب به سرنخ/مشتری CRM.
 *   • ستون‌های `issued_at` و `paid_at` برای گردش وضعیت.
 *   • ستون `tenants.default_vat_rate` با پیش‌فرض ۰٫۱ (۱۰٪) برای تنظیم VAT هر سازمان.
 *   • ایندکس ترکیبی `(tenant_id, customer_id)` برای فهرست صورتحساب‌های مشتری.
 *
 * نرخ VAT هر سطر داخل JSONB `invoices.items` نگه داشته می‌شود و نیازی به
 * ستون جداگانه ندارد.
 */
export class AddInvoicingVatCustomerPaid1789210000000
  implements MigrationInterface
{
  name = 'AddInvoicingVatCustomerPaid1789210000000';

  // No `transaction = false`: the deploy runner uses transaction mode "all", which rejects
  // per-migration overrides (ForbiddenTransactionModeOverrideError, 2026-10-22). PostgreSQL 12+
  // allows ALTER TYPE ... ADD VALUE inside a transaction as long as the new value is not used in
  // the same transaction, and this migration never uses 'PAID'.

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."invoices_status_enum" ADD VALUE IF NOT EXISTS 'PAID'`,
    );

    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "customer_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "issued_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoices_tenant_customer" ON "invoices" ("tenant_id", "customer_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "default_vat_rate" numeric(5,4) NOT NULL DEFAULT 0.1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenants" DROP COLUMN IF EXISTS "default_vat_rate"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_invoices_tenant_customer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "paid_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "issued_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN IF EXISTS "customer_id"`,
    );
    // PostgreSQL امکان حذف یک مقدار از enum را بدون بازسازی نوع نمی‌دهد؛
    // مقدار PAID بی‌استفاده باقی می‌ماند و به داده موجود آسیب نمی‌زند.
  }
}
