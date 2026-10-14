import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * جداسازی مستأجر (Multi-Tenant) برای ماژول Damages — Wave 4.
 *
 * جدول `damage_calculations` پیش‌تر هیچ ستون مستأجری نداشت و خواندن/نوشتن میان
 * همه سازمان‌ها مشترک بود. این Migration:
 *   • ستون `tenant_id` را اضافه و ردیف‌های موجود را با مستأجر پیش‌فرض پر می‌کند؛
 *   • ستون را NOT NULL می‌کند؛
 *   • ایندکس‌های ترکیبی لازم برای کوئری‌های مستأجری را می‌سازد؛
 *   • ایندکس تک‌ستونی `contractReferenceNumber` را به ایندکس ترکیبی
 *     `(tenant_id, "contractReferenceNumber")` تبدیل می‌کند تا فیلتر مرجع قرارداد
 *     هرگز ردیف‌های سازمان دیگر را برنگرداند.
 *
 * این Migration فقط از طریق PR بازبینی‌شده اعمال می‌شود و هرگز به
 * synchronize=true تکیه نمی‌کند (Rule #4 - AGENTS.md).
 */
export class AddDamagesTenantIsolation1789180000000
  implements MigrationInterface
{
  name = 'AddDamagesTenantIsolation1789180000000';

  /** شناسه ثابت مستأجر پیش‌فرض (همان مقدار backfill در 1789120000000). */
  private readonly defaultTenantId = '00000000-0000-0000-0000-000000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // damage_calculations — افزودن، پرکردن و الزامی‌کردن ستون مستأجر
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "damage_calculations" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "damage_calculations" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL`,
      [this.defaultTenantId],
    );
    await queryRunner.query(
      `ALTER TABLE "damage_calculations" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );

    // ------------------------------------------------------------------
    // ایندکس‌های مسیر کوئری مستأجری
    // ------------------------------------------------------------------
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_damage_calculations_contractReferenceNumber"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_damage_calculations_tenant_contractReferenceNumber" ON "damage_calculations" ("tenant_id", "contractReferenceNumber")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_damage_calculations_tenant_createdAt" ON "damage_calculations" ("tenant_id", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // حذف ایندکس‌های مستأجری و بازگرداندن ایندکس مرجع قرارداد
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_damage_calculations_tenant_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_damage_calculations_tenant_contractReferenceNumber"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_damage_calculations_contractReferenceNumber" ON "damage_calculations" ("contractReferenceNumber")`,
    );
    await queryRunner.query(
      `ALTER TABLE "damage_calculations" DROP COLUMN IF EXISTS "tenant_id"`,
    );
  }
}
