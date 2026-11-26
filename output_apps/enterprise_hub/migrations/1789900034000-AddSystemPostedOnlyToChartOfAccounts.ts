import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T226 (R19):
 * 1. Add `system_posted_only` boolean flag on `fin_chart_of_accounts`.
 *    Control accounts (AR, AP, inventory, and fixed assets) accept entries only from operational
 *    subledgers and system processes; manual journal entries on them are refused except during an
 *    open server-side adjustment period by an authorized finance role.
 * 2. Add `adjustment_period_open` boolean flag on `fin_fiscal_years` so adjustment-period state is
 *    decided authoritatively on the server rather than by a client-supplied DTO flag.
 *
 * Backfill safety:
 * - Runs per-tenant with `set_config('app.tenant_id', ...)` so it updates rows even under
 *   FORCE ROW LEVEL SECURITY when the migration role does not have BYPASSRLS.
 * - Flags by `report_line` (never blindly by account code on custom charts), plus the three
 *   unclassified legacy default-chart accounts only when BOTH code AND exact default Persian name
 *   match (`1020`, `1030`, `2010`).
 */
export class AddSystemPostedOnlyToChartOfAccounts1789900034000
  implements MigrationInterface
{
  name = 'AddSystemPostedOnlyToChartOfAccounts1789900034000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      ALTER TABLE "fin_chart_of_accounts"
        ADD COLUMN IF NOT EXISTS "system_posted_only" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "fin_fiscal_years"
        ADD COLUMN IF NOT EXISTS "adjustment_period_open" boolean NOT NULL DEFAULT false
    `);

    // RLS-safe backfill: iterate tenants and set app.tenant_id before updating fin_chart_of_accounts.
    await queryRunner.query(`
      DO $$
      DECLARE
        v_tenant uuid;
      BEGIN
        FOR v_tenant IN SELECT "id" FROM "tenants" LOOP
          PERFORM set_config('app.tenant_id', v_tenant::text, true);
          UPDATE "fin_chart_of_accounts"
          SET "system_posted_only" = true
          WHERE "tenant_id" = v_tenant
            AND "system_posted_only" = false
            AND (
              "report_line" IN ('RECEIVABLE', 'PAYABLE', 'INVENTORY', 'FIXED_ASSET', 'ACCUMULATED_DEPRECIATION')
              OR (
                "report_line" IS NULL AND (
                  ("code" = '1020' AND "name" = 'حساب‌های دریافتنی تجاری')
                  OR ("code" = '1030' AND "name" = 'موجودی کالا')
                  OR ("code" = '2010' AND "name" = 'حساب‌های پرداختنی تجاری')
                )
              )
            );
        END LOOP;
        PERFORM set_config('app.tenant_id', '', true);
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_chart_of_accounts_tenant_system_posted"
        ON "fin_chart_of_accounts" ("tenant_id", "system_posted_only")
        WHERE "system_posted_only" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_fin_chart_of_accounts_tenant_system_posted"
    `);
    await queryRunner.query(`
      ALTER TABLE "fin_fiscal_years"
        DROP COLUMN IF EXISTS "adjustment_period_open"
    `);
    await queryRunner.query(`
      ALTER TABLE "fin_chart_of_accounts"
        DROP COLUMN IF EXISTS "system_posted_only"
    `);
  }
}
