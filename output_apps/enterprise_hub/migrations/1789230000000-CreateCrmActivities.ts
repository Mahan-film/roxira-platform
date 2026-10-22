import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ایجاد جدول فعالیت‌های CRM (`crm_activities`) برای ورود بستهٔ دیتابیس.
 *
 * هر فعالیت یک پیگیری/تماس روی یک طرف حساب (کد تفصیلی) است. ستون `tenant_id`
 * و ایندکس‌های آن، جداسازی مستأجر را تضمین می‌کنند (Rule #4 - AGENTS.md).
 */
export class CreateCrmActivities1789230000000 implements MigrationInterface {
  name = 'CreateCrmActivities1789230000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "crm_activities" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "party_code" character varying(100),
        "activity_date" character varying(20),
        "owner" character varying(120),
        "channel" character varying(60),
        "stage" character varying(60),
        "currency" character varying(16),
        "amount" numeric(18,2),
        "probability" integer,
        "notes" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_crm_activities_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_crm_activities_tenant_party" ON "crm_activities" ("tenant_id", "party_code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_crm_activities_tenant_party"`,
    );
    await queryRunner.query(`DROP TABLE "crm_activities"`);
  }
}
