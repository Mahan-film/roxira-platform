import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Safe rebuild of `data_import_cutovers` (#1217, after #1215 reverted #1202):
 * - Idempotent `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` so production
 *   (where the original table remained after revert) migrates cleanly without error.
 * - Enforces at most ONE active cutover per tenant via unique partial index
 *   `UQ_data_import_cutovers_one_active_per_tenant` on `(tenant_id) WHERE is_go_live_active = true`.
 * - Enables and forces tenant RLS (`enableTenantRls`, idempotent).
 * - Uses `SET LOCAL lock_timeout` inside TypeORM's standard transaction mode `"all"`.
 */
export class CreateSafeDataImportCutovers1789900020000
  implements MigrationInterface
{
  name = 'CreateSafeDataImportCutovers1789900020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`SET LOCAL statement_timeout = '30s'`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "data_import_cutovers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "cutover_date" text NOT NULL,
        "pre_cutover_lock_date" text NOT NULL,
        "period_lock_id" integer NOT NULL,
        "opening_journal_entry_id" integer NULL,
        "legacy_number_prefix" text NOT NULL DEFAULT 'LEGACY-',
        "is_go_live_active" boolean NOT NULL DEFAULT true,
        "executed_by" text NULL,
        "metadata" jsonb NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_data_import_cutovers_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "data_import_cutovers"
      ADD COLUMN IF NOT EXISTS "executed_by" text NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_data_import_cutovers_one_active_per_tenant"
      ON "data_import_cutovers" ("tenant_id")
      WHERE "is_go_live_active" = true
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_data_import_cutovers_tenant"
    `);
    await enableTenantRls(queryRunner, 'data_import_cutovers');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await disableTenantRls(queryRunner, 'data_import_cutovers');
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_data_import_cutovers_one_active_per_tenant"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "data_import_cutovers"`);
  }
}
