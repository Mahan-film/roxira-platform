import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Recurring journal voucher templates and their run history (#551, E-04).
 *
 * A template stores a balanced set of journal lines as JSONB plus the frequency and the next
 * Jalali run date. Every time a period falls due a row is written to `erp_recurring_voucher_runs`
 * first; the unique key (tenant, recurring, run_date) makes a second runner's insert a no-op, so a
 * voucher can never be created twice. The run also tracks the reversal of an auto-reversing
 * accrual. Both tables carry `tenant_id` with FORCE row-level security, exactly like erp_parties.
 * Purely additive.
 */
export class CreateRecurringVouchers1789900000100 implements MigrationInterface {
  name = 'CreateRecurringVouchers1789900000100';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE IF NOT EXISTS "erp_recurring_vouchers" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "name" character varying(200) NOT NULL,
        "description" text NOT NULL,
        "lines" jsonb NOT NULL,
        "frequency" character varying(16) NOT NULL,
        "next_run_date" date NOT NULL,
        "end_date" date,
        "auto_reverse" boolean NOT NULL DEFAULT false,
        "active" boolean NOT NULL DEFAULT true,
        "created_by" character varying(64) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_erp_recurring_vouchers_frequency" CHECK ("frequency" IN ('MONTHLY','QUARTERLY','YEARLY')),
        CONSTRAINT "CHK_erp_recurring_vouchers_name" CHECK ("name" <> '')
      )`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_recurring_vouchers_tenant_due" ON "erp_recurring_vouchers" ("tenant_id", "active", "next_run_date")`,
    );

    await q.query(
      `CREATE TABLE IF NOT EXISTS "erp_recurring_voucher_runs" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "recurring_id" integer NOT NULL,
        "run_date" date NOT NULL,
        "journal_entry_id" integer,
        "reversal_entry_id" integer,
        "reversal_date" date,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_erp_recurring_voucher_runs_recurring" FOREIGN KEY ("recurring_id")
          REFERENCES "erp_recurring_vouchers" ("id") ON DELETE CASCADE
      )`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_erp_recurring_voucher_runs_tenant_recurring_date"
         ON "erp_recurring_voucher_runs" ("tenant_id", "recurring_id", "run_date")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_erp_recurring_voucher_runs_due_reversal"
         ON "erp_recurring_voucher_runs" ("tenant_id", "reversal_date")`,
    );

    await enableTenantRls(q, 'erp_recurring_vouchers');
    await enableTenantRls(q, 'erp_recurring_voucher_runs');
  }

  public async down(q: QueryRunner): Promise<void> {
    await disableTenantRls(q, 'erp_recurring_voucher_runs');
    await disableTenantRls(q, 'erp_recurring_vouchers');
    await q.query(`DROP TABLE IF EXISTS "erp_recurring_voucher_runs"`);
    await q.query(`DROP TABLE IF EXISTS "erp_recurring_vouchers"`);
  }
}
