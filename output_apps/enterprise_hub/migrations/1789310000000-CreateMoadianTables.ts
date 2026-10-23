import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * جداول اتصال زنده به سامانه مودیان.
 *
 * - `moadian_credentials`: یک ردیف برای هر مستأجر — شناسه حافظه مالیاتی، شماره
 *   اقتصادی، گواهی و کلید خصوصی رمزشده (AES-256-GCM، هرگز متن ساده) و شمارنده
 *   سریال صورتحساب.
 * - `moadian_submissions`: وضعیت ارسال هر صورتحساب (uid، taxid، شماره مرجع،
 *   خطاها/هشدارهای استعلام).
 *
 * هر دو جدول ستون `tenant_id` دارند و دسترسی در MoadianRepository به همان
 * مستأجر محدود است (Rule #4 - AGENTS.md).
 */
export class CreateMoadianTables1789310000000 implements MigrationInterface {
  name = 'CreateMoadianTables1789310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "moadian_credentials" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "memory_id" character varying(6) NOT NULL,
        "economic_code" character varying(14) NOT NULL,
        "certificate_pem" text NOT NULL,
        "private_key_sealed" text NOT NULL,
        "key_fingerprint" character varying(128) NOT NULL,
        "default_sstid" character varying(13),
        "default_measurement_unit" character varying(16),
        "settlement_method" smallint NOT NULL DEFAULT 1,
        "next_serial" bigint NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_moadian_credentials_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_moadian_credentials_tenant" ON "moadian_credentials" ("tenant_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "moadian_submissions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "invoice_id" uuid NOT NULL,
        "uid" uuid NOT NULL,
        "tax_id" character varying(22) NOT NULL,
        "serial" bigint NOT NULL,
        "reference_number" character varying(64),
        "status" character varying(16) NOT NULL DEFAULT 'QUEUED',
        "errors" jsonb NOT NULL DEFAULT '[]',
        "warnings" jsonb NOT NULL DEFAULT '[]',
        "poll_count" integer NOT NULL DEFAULT 0,
        "sent_at" TIMESTAMP,
        "last_polled_at" TIMESTAMP,
        "packet" jsonb NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_moadian_submissions_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_moadian_submissions_tenant_invoice" ON "moadian_submissions" ("tenant_id", "invoice_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_moadian_submissions_tenant_tax_id" ON "moadian_submissions" ("tenant_id", "tax_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_moadian_submissions_tenant_status" ON "moadian_submissions" ("tenant_id", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_moadian_submissions_tenant_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_moadian_submissions_tenant_tax_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_moadian_submissions_tenant_invoice"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "moadian_submissions"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_moadian_credentials_tenant"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "moadian_credentials"`);
  }
}
