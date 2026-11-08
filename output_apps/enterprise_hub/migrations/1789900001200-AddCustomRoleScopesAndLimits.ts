import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds scope (org / branch / warehouse), per-permission amount limits (stored as exact decimal
 * strings parsed via `money.ts` `parseMinor`), and field-level visibility (`cost`, `margin`,
 * `salary`) to `tenant_roles` (#584 item 3).
 */
export class AddCustomRoleScopesAndLimits1789900001200 implements MigrationInterface {
  name = 'AddCustomRoleScopesAndLimits1789900001200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_roles"
        ADD COLUMN IF NOT EXISTS "scope_type" varchar(20) NOT NULL DEFAULT 'org',
        ADD COLUMN IF NOT EXISTS "scope_ids" uuid[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "amount_limits" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "field_visibility" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_tenant_roles_scope_type'
        ) THEN
          ALTER TABLE "tenant_roles"
            ADD CONSTRAINT "CHK_tenant_roles_scope_type"
            CHECK ("scope_type" IN ('org', 'branch', 'warehouse'));
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_roles"
        DROP CONSTRAINT IF EXISTS "CHK_tenant_roles_scope_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_roles"
        DROP COLUMN IF EXISTS "field_visibility",
        DROP COLUMN IF EXISTS "amount_limits",
        DROP COLUMN IF EXISTS "scope_ids",
        DROP COLUMN IF EXISTS "scope_type"
    `);
  }
}
