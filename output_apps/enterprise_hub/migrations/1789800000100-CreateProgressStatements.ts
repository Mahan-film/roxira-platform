import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Progress Statements (T3, #520): progress_statements table for contracts, with RLS, FK to contracts, and CHECK constraints.
 */
export class CreateProgressStatements1789800000100 implements MigrationInterface {
  name = 'CreateProgressStatements1789800000100';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "erp_progress_statements" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "contract_id" integer NOT NULL,
        "number" integer NOT NULL,
        "statement_date" date NOT NULL,
        "cumulative_amount" numeric(18,2) NOT NULL,
        "previous_amount" numeric(18,2) NOT NULL,
        "period_amount" numeric(18,2) NOT NULL,
        "retention_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "insurance_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "advance_recovery_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "status" character varying(16) NOT NULL DEFAULT 'draft',
        "approved_at" TIMESTAMP,
        "posted_at" TIMESTAMP,
        "journal_entry_id" integer,
        "journal_entry_number" character varying(64),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_erp_progress_statements_number" CHECK ("number" >= 1),
        CONSTRAINT "CHK_erp_progress_statements_previous" CHECK ("previous_amount" >= 0),
        CONSTRAINT "CHK_erp_progress_statements_cumulative" CHECK ("cumulative_amount" > "previous_amount"),
        CONSTRAINT "CHK_erp_progress_statements_period" CHECK ("period_amount" = "cumulative_amount" - "previous_amount"),
        CONSTRAINT "CHK_erp_progress_statements_deductions" CHECK (
            "retention_amount" >= 0 AND "insurance_amount" >= 0 AND "advance_recovery_amount" >= 0 
            AND "retention_amount" + "insurance_amount" + "advance_recovery_amount" <= "period_amount"
        ),
        CONSTRAINT "CHK_erp_progress_statements_status" CHECK ("status" IN ('draft','approved','posted')),
        CONSTRAINT "FK_erp_progress_statements_contract" FOREIGN KEY ("tenant_id", "contract_id") REFERENCES "erp_contracts" ("tenant_id", "id") ON DELETE RESTRICT
      )`,
    );
    await q.query(`CREATE UNIQUE INDEX "UQ_erp_progress_statements_number" ON "erp_progress_statements" ("tenant_id", "contract_id", "number")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_erp_progress_statements_tenant_id" ON "erp_progress_statements" ("tenant_id", "id")`);
    await q.query(`CREATE INDEX "IDX_erp_progress_statements_tenant_contract_status" ON "erp_progress_statements" ("tenant_id", "contract_id", "status")`);
    await enableTenantRls(q, 'erp_progress_statements');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'erp_progress_statements');
    await q.query(`DROP TABLE IF EXISTS "erp_progress_statements"`);
  }
}
