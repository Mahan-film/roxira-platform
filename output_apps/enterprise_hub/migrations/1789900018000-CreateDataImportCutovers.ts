import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * ایجاد جدول کات‌اوور و ورود به عملیات زنده (`data_import_cutovers`).
 * - نگهداری وضعیت Cutover Wizard، تاریخ شروع عملیات زنده، تاریخ قفل دوره پیش از کات‌اوور،
 *   شناسه قفل دوره حسابداری، شناسه سند افتتاحیه و پیشوند سری موروثی (R32 D4/D5).
 * - دارای ستون `tenant_id` و فعال‌سازی اجباری FORCE RLS (NOSUPERUSER NOBYPASSRLS).
 */
export class CreateDataImportCutovers1789900018000 implements MigrationInterface {
  name = 'CreateDataImportCutovers1789900018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "data_import_cutovers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "cutover_date" character varying(10) NOT NULL,
        "pre_cutover_lock_date" character varying(10) NOT NULL,
        "period_lock_id" integer NOT NULL,
        "opening_journal_entry_id" integer NULL,
        "legacy_number_prefix" character varying(32) NOT NULL DEFAULT 'LEGACY-',
        "is_go_live_active" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_data_import_cutovers_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_data_import_cutovers_tenant"
      ON "data_import_cutovers" ("tenant_id")
    `);

    await enableTenantRls(queryRunner, 'data_import_cutovers');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await disableTenantRls(queryRunner, 'data_import_cutovers');

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_data_import_cutovers_tenant"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "data_import_cutovers"`);
  }
}
