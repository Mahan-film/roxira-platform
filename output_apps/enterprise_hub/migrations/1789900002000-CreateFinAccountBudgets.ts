import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Account budgets for Budget vs Actual report (Task T52 / #230):
 *   - `fin_account_budgets`: tenant-scoped budget caps per fiscal year, account code, and optional cost centre.
 *   - Protected with `ENABLE` + `FORCE ROW LEVEL SECURITY`.
 */
export class CreateFinAccountBudgets1789900002000 implements MigrationInterface {
  name = 'CreateFinAccountBudgets1789900002000';

  private readonly table = 'fin_account_budgets';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_account_budgets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "fiscal_year_id" integer NOT NULL,
        "cost_center_id" integer NULL,
        "account_code" varchar(32) NOT NULL,
        "budget_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_account_budgets" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fin_account_budgets_amount" CHECK ("budget_amount" >= 0)
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_account_budgets_tenant_fy"
        ON "fin_account_budgets" ("tenant_id", "fiscal_year_id")
    `);

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fin_account_budgets_scope"
        ON "fin_account_budgets" ("tenant_id", "fiscal_year_id", "account_code", COALESCE("cost_center_id", 0))
    `);

    await enableTenantRls(q, this.table);
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, this.table);
    await q.query(`DROP TABLE IF EXISTS "fin_account_budgets"`);
  }
}
