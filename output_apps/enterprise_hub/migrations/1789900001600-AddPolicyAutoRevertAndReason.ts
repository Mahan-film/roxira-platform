import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 1789900001600: Add auto_revert_at and reason columns to tenant_policy_settings (#584-6).
 * Supports automatic reverting of weakened controls and tracking of reasons in the exceptions report.
 */
export class AddPolicyAutoRevertAndReason1789900001600 implements MigrationInterface {
  name = 'AddPolicyAutoRevertAndReason1789900001600';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "tenant_policy_settings"
      ADD COLUMN IF NOT EXISTS "auto_revert_at" timestamptz NULL,
      ADD COLUMN IF NOT EXISTS "reason" text NULL
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tenant_policy_settings_auto_revert"
      ON "tenant_policy_settings" ("auto_revert_at")
      WHERE "auto_revert_at" IS NOT NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_tenant_policy_settings_auto_revert"`);
    await q.query(`
      ALTER TABLE "tenant_policy_settings"
      DROP COLUMN IF EXISTS "reason",
      DROP COLUMN IF EXISTS "auto_revert_at"
    `);
  }
}
