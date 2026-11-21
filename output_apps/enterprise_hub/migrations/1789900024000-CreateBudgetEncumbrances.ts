import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * T194 budget encumbrance:
 *   - `fin_budget_encumbrances`: open/released PO commitments against account + cost-centre budgets.
 *   - `erp_purchase_orders`: optional `account_code` and `cost_center_code` for budget checks.
 */
export class CreateBudgetEncumbrances1789900024000 implements MigrationInterface {
  name = 'CreateBudgetEncumbrances1789900024000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_budget_encumbrances" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "account_code" varchar(32) NOT NULL,
        "cost_center_code" varchar(64) NOT NULL DEFAULT '',
        "period_key" varchar(16) NOT NULL,
        "source_type" varchar(32) NOT NULL DEFAULT 'purchase_order',
        "source_id" varchar(128) NOT NULL,
        "amount_minor" bigint NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'OPEN',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_budget_encumbrances" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_fin_budget_encumbrances_source" UNIQUE ("tenant_id", "source_type", "source_id"),
        CONSTRAINT "CHK_fin_budget_encumbrances_amount" CHECK ("amount_minor" >= 0),
        CONSTRAINT "CHK_fin_budget_encumbrances_status" CHECK ("status" IN ('OPEN', 'RELEASED'))
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_budget_encumbrances_lookup"
        ON "fin_budget_encumbrances" ("tenant_id", "account_code", "cost_center_code", "period_key", "status")
    `);

    await enableTenantRls(q, 'fin_budget_encumbrances');

    await q.query(`
      ALTER TABLE "erp_purchase_orders"
        ADD COLUMN IF NOT EXISTS "account_code" varchar(32) NULL,
        ADD COLUMN IF NOT EXISTS "cost_center_code" varchar(64) NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "erp_purchase_orders"
        DROP COLUMN IF EXISTS "cost_center_code",
        DROP COLUMN IF EXISTS "account_code"
    `);
    await disableTenantRls(q, 'fin_budget_encumbrances');
    await q.query(`DROP TABLE IF EXISTS "fin_budget_encumbrances"`);
  }
}
