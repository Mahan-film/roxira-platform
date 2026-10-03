import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * جداسازی مستأجر (Multi-Tenant) برای ماژول CRM.
 *
 * جداول `crm_leads` و `contact_messages` پیش‌تر هیچ ستون مستأجری نداشتند و
 * خواندن/نوشتن میان همه مشتریان مشترک بود. این Migration ستون `tenant_id` را
 * اضافه می‌کند، ردیف‌های موجود (که در محیط عملیاتی خالی‌اند) را با یک مستأجر
 * پیش‌فرض ثابت پر می‌کند، سپس NOT NULL و ایندکس‌های ترکیبی لازم برای کوئری‌های
 * مستأجری را می‌سازد (Rule #4 - AGENTS.md).
 *
 * این Migration عمداً اجرا نمی‌شود و فقط از طریق PR بازبینی‌شده اعمال می‌گردد.
 */
export class AddCrmTenantIsolation1789120000000
  implements MigrationInterface
{
  name = 'AddCrmTenantIsolation1789120000000';

  /** مستأجر پیش‌فرض برای پرکردن ردیف‌های موجود پیش از NOT NULL. */
  private readonly defaultTenantId = '00000000-0000-0000-0000-000000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // crm_leads — افزودن، پرکردن و الزامی‌کردن ستون مستأجر
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "crm_leads" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL`,
      [this.defaultTenantId],
    );
    await queryRunner.query(
      `ALTER TABLE "crm_leads" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crm_leads_tenant_stage" ON "crm_leads" ("tenant_id", "pipeline_stage")`,
    );

    // ------------------------------------------------------------------
    // contact_messages — افزودن، پرکردن و الزامی‌کردن ستون مستأجر
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "contact_messages" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL`,
      [this.defaultTenantId],
    );
    await queryRunner.query(
      `ALTER TABLE "contact_messages" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_contact_messages_tenant_lead" ON "contact_messages" ("tenant_id", "lead_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_contact_messages_tenant_lead"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_messages" DROP COLUMN IF EXISTS "tenant_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_crm_leads_tenant_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crm_leads" DROP COLUMN IF EXISTS "tenant_id"`,
    );
  }
}
