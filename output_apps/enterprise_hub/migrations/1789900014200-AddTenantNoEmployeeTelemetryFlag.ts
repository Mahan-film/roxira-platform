import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T265 (R26): Add `no_employee_telemetry` boolean flag on `tenants` for
 * works-council mode (BetrVG §87(1)6), hiding per-user activity dashboards
 * and individual AI usage analytics.
 */
export class AddTenantNoEmployeeTelemetryFlag1789900014200
  implements MigrationInterface
{
  name = 'AddTenantNoEmployeeTelemetryFlag1789900014200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      ALTER TABLE "tenants"
        ADD COLUMN IF NOT EXISTS "no_employee_telemetry" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      ALTER TABLE "tenants"
        DROP COLUMN IF EXISTS "no_employee_telemetry"
    `);
  }
}
