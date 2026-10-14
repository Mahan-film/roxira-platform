import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ایجاد جدول `enterprise_inquiries` منطبق بر EnterpriseInquiryEntity
 * (ماژول پیش‌ثبت‌نام و درخواست همکاری سازمانی — inquiries).
 *
 * ستون `tenant_id` به‌عنوان ستون مالکیت (Rule #4 - AGENTS.md) اضافه شده و
 * برای درخواست‌های عمومی مقدار NULL دارد (NULL = درخواست عمومی/بدون مستأجر).
 *
 * طبق قاعده Contract-First Synchronization (AGENTS.md بخش ۲.۴) اسکیمای
 * پایگاه‌داده صریحاً از طریق Migration ایجاد می‌شود و هرگز به
 * synchronize=true در محیط production تکیه نمی‌گردد. این Migration فقط از
 * طریق PR بازبینی‌شده و با deploy_local.sh migrate اعمال می‌گردد.
 */
export class CreateEnterpriseInquiriesTable1789130000000
  implements MigrationInterface
{
  name = 'CreateEnterpriseInquiriesTable1789130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "enterprise_inquiries" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid,
        "name" character varying(150) NOT NULL,
        "company" character varying(150),
        "phone" character varying(50),
        "email" character varying(150),
        "message" text,
        "source" character varying(64),
        "status" character varying(20) NOT NULL DEFAULT 'NEW',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_enterprise_inquiries_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_enterprise_inquiries_status" ON "enterprise_inquiries" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_enterprise_inquiries_created_at" ON "enterprise_inquiries" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_enterprise_inquiries_tenant" ON "enterprise_inquiries" ("tenant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_enterprise_inquiries_tenant"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_enterprise_inquiries_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_enterprise_inquiries_status"`,
    );
    await queryRunner.query(`DROP TABLE "enterprise_inquiries"`);
  }
}
