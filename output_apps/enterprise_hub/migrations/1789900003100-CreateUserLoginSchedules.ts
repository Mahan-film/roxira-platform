import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * User login allowed time windows with schedule enforcement (Task T76 / #738).
 * Stores per-user weekly schedules with timezone and time window rules.
 * Protected with ENABLE + FORCE ROW LEVEL SECURITY.
 */
export class CreateUserLoginSchedules1789900003100 implements MigrationInterface {
  name = 'CreateUserLoginSchedules1789900003100';

  private readonly table = 'user_login_schedules';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "user_login_schedules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "timezone" varchar(64) NOT NULL DEFAULT 'Asia/Tehran',
        "enforce_schedule" boolean NOT NULL DEFAULT true,
        "windows" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_login_schedules" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_login_schedules_tenant_user" UNIQUE ("tenant_id", "user_id")
      )
    `);

    await enableTenantRls(q, this.table);
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, this.table);
    await q.query(`DROP TABLE IF EXISTS "user_login_schedules"`);
  }
}
