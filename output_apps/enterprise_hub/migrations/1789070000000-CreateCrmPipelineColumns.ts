import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * افزودن ستون‌های تکمیلی ماژول CRM و پایپ‌لاین سرنخ‌ها.
 *
 * چرا Migration جداگانه؟
 * جداول `crm_leads` و `contact_messages` پیش‌تر توسط لایه پایتونی/سایت
 * ایجاد شده‌اند و تنها حداقل ستون‌ها را دارند. برای مدیریت واقعی پایپ‌لاین
 * فروش به ارزش ریالی فرصت، اطلاعات تماس، کارشناس مسئول، زمان آخرین تغییر و
 * اتصال سوابق تماس به سرنخ نیاز داریم.
 *
 * طبق Rule #4 AGENTS.md (Contract-First Synchronization) این تغییر صریحاً از
 * طریق Migration اعمال می‌شود و هرگز به synchronize=true تکیه نمی‌کنیم.
 */
export class CreateCrmPipelineColumns1789070000000
  implements MigrationInterface
{
  name = 'CreateCrmPipelineColumns1789070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // crm_leads — اطلاعات تکمیلی سرنخ و ارزش فرصت
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "phone" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "company" character varying(150)`,
    );
    await queryRunner.query(
      `ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "estimated_value" numeric(18,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "owner" character varying(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    );

    // ------------------------------------------------------------------
    // contact_messages — اتصال سوابق تماس به سرنخ و نوع کانال تعامل
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "lead_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "channel" character varying(50) DEFAULT 'PHONE'`,
    );

    await queryRunner.query(
      `ALTER TABLE "contact_messages" DROP CONSTRAINT IF EXISTS "FK_contact_messages_lead"`,
    );
    await queryRunner.query(`
      ALTER TABLE "contact_messages"
      ADD CONSTRAINT "FK_contact_messages_lead"
      FOREIGN KEY ("lead_id")
      REFERENCES "crm_leads"("id")
      ON DELETE CASCADE
    `);

    // ------------------------------------------------------------------
    // ایندکس‌های تحلیلی
    // ------------------------------------------------------------------
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crm_leads_pipeline_stage" ON "crm_leads" ("pipeline_stage")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_contact_messages_lead" ON "contact_messages" ("lead_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_contact_messages_lead"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_crm_leads_pipeline_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_messages" DROP CONSTRAINT IF EXISTS "FK_contact_messages_lead"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_messages" DROP COLUMN IF EXISTS "channel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_messages" DROP COLUMN IF EXISTS "lead_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crm_leads" DROP COLUMN IF EXISTS "updated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crm_leads" DROP COLUMN IF EXISTS "owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crm_leads" DROP COLUMN IF EXISTS "estimated_value"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crm_leads" DROP COLUMN IF EXISTS "company"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crm_leads" DROP COLUMN IF EXISTS "phone"`,
    );
  }
}
