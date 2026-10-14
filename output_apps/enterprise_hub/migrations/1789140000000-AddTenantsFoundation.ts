import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * پایه جداسازی مستأجر (Multi-Tenant) — Wave 0.
 *
 * این Migration زیرساخت اولیه مستأجر را می‌سازد:
 *   • ایجاد جدول `tenants` و درج مستأجر پیش‌فرض «Roxira» (شناسه ثابت).
 *   • افزودن `users.tenant_id` و `users.tenant_role` (به‌صورت NULLپذیر، چون
 *     جدول users با سامانه قاضی هوشمند مشترک است و کاربر بدون سازمان باید
 *     بتواند وجود داشته باشد).
 *   • پرکردن کاربران `ADMIN` (اپراتور پلتفرم) با مستأجر پیش‌فرض و نقش OWNER.
 *   • گسترش ایندکس یکتای `crm_leads.email` به ایندکس ترکیبی
 *     `(tenant_id, email)` تا یک رایانامه بتواند در سازمان‌های مختلف تکرار شود.
 *
 * طبق Rule #4 AGENTS.md (Contract-First Synchronization) این تغییر صریحاً از
 * طریق Migration اعمال می‌شود و هرگز به synchronize=true تکیه نمی‌کنیم.
 * ردیف‌های CRM پیش‌تر در Migration 1789120000000 با همین شناسه پیش‌فرض
 * پر شده‌اند.
 */
export class AddTenantsFoundation1789140000000 implements MigrationInterface {
  name = 'AddTenantsFoundation1789140000000';

  /** شناسه ثابت مستأجر پیش‌فرض (همان مقدار backfill در 1789120000000). */
  private readonly defaultTenantId = '00000000-0000-0000-0000-000000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // tenants — ایجاد جدول سازمان‌ها و درج مستأجر پیش‌فرض
    // ------------------------------------------------------------------
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE "tenants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(150) NOT NULL,
        "slug" character varying(80) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenants_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_tenants_slug" ON "tenants" ("slug")`,
    );
    await queryRunner.query(
      `INSERT INTO "tenants" ("id", "name", "slug")
       VALUES ($1, 'Roxira', 'roxira')
       ON CONFLICT ("id") DO NOTHING`,
      [this.defaultTenantId],
    );

    // ------------------------------------------------------------------
    // users — افزودن ستون‌های مستأجر و ایندکس
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tenant_role" character varying(20)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_tenant_id" ON "users" ("tenant_id")`,
    );

    // اپراتورهای پلتفرم (ADMIN) به مستأجر پیش‌فرض و نقش OWNER منتقل می‌شوند؛
    // سایر کاربران NULL می‌مانند (مثلاً کاربران قاضی هوشمند).
    await queryRunner.query(
      `UPDATE "users" SET "tenant_id" = $1, "tenant_role" = 'OWNER' WHERE "role" = 'ADMIN'`,
      [this.defaultTenantId],
    );

    // ------------------------------------------------------------------
    // crm_leads — گسترش ایندکس یکتا از email به (tenant_id, email)
    // ------------------------------------------------------------------
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_crm_leads_email"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_crm_leads_tenant_email" ON "crm_leads" ("tenant_id", "email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // بازگرداندن ایندکس یکتای رایانامه در سطح کل جدول
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_crm_leads_tenant_email"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ix_crm_leads_email" ON "crm_leads" ("email")`,
    );

    // حذف ستون‌ها و ایندکس مستأجر از users
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_tenant_id"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "tenant_role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "tenant_id"`,
    );

    // حذف جدول سازمان‌ها (شامل مستأجر پیش‌فرض)
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tenants_slug"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenants"`);
  }
}
