import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Iranian reporting layer, part 1 (additive only):
 *  - fin_chart_of_accounts: `level` (GROUP/KOL/MOEIN/TAFSILI), `parent_code`, `report_line`. All
 *    nullable: imported and legacy accounts keep working and are classified at report time.
 *  - fin_journal_entries: `entry_type`. Adding a column with a default does not fire the immutable
 *    posted-entry trigger, and every existing entry stays NORMAL.
 *  - fin_fiscal_years: fiscal calendar and close state, with tenant RLS as a second wall behind the
 *    repository (same policy as tenant_roles; rows are visible only under `app.tenant_id`).
 */
export class AddChartHierarchyAndFiscalYears1789370000000 implements MigrationInterface {
  name = 'AddChartHierarchyAndFiscalYears1789370000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "fin_chart_of_accounts" ADD COLUMN "level" character varying(12)`);
    await q.query(`ALTER TABLE "fin_chart_of_accounts" ADD COLUMN "parent_code" character varying(32)`);
    await q.query(`ALTER TABLE "fin_chart_of_accounts" ADD COLUMN "report_line" character varying(32)`);
    await q.query(
      `ALTER TABLE "fin_chart_of_accounts" ADD CONSTRAINT "CHK_fin_chart_of_accounts_level"
         CHECK ("level" IS NULL OR "level" IN ('GROUP','KOL','MOEIN','TAFSILI'))`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" ADD COLUMN "entry_type" character varying(16) NOT NULL DEFAULT 'NORMAL'`,
    );
    await q.query(
      `ALTER TABLE "fin_journal_entries" ADD CONSTRAINT "CHK_fin_journal_entries_entry_type"
         CHECK ("entry_type" IN ('NORMAL','OPENING','CLOSING_TEMP','CLOSING_PERM','OPENING_AUTO'))`,
    );
    await q.query(`
      CREATE TABLE "fin_fiscal_years" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "name" character varying(32) NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "status" character varying(8) NOT NULL DEFAULT 'OPEN',
        "close_seq" integer NOT NULL DEFAULT 0,
        "closed_at" TIMESTAMP WITH TIME ZONE,
        "closed_by" character varying(64),
        "period_lock_id" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_fin_fiscal_years_status" CHECK ("status" IN ('OPEN','CLOSED')),
        CONSTRAINT "CHK_fin_fiscal_years_range" CHECK ("start_date" <= "end_date"),
        CONSTRAINT "FK_fin_fiscal_years_lock" FOREIGN KEY ("period_lock_id")
          REFERENCES "fin_period_locks"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_fin_fiscal_years_tenant_start" ON "fin_fiscal_years" ("tenant_id", "start_date")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_fin_fiscal_years_tenant_name" ON "fin_fiscal_years" ("tenant_id", "name")`);
    const tenantMatch = `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`;
    await q.query(`ALTER TABLE "fin_fiscal_years" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "fin_fiscal_years" FORCE ROW LEVEL SECURITY`);
    await q.query(
      `CREATE POLICY "fin_fiscal_years_tenant" ON "fin_fiscal_years" USING (${tenantMatch}) WITH CHECK (${tenantMatch})`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "fin_fiscal_years"`);
    await q.query(`ALTER TABLE "fin_journal_entries" DROP CONSTRAINT "CHK_fin_journal_entries_entry_type"`);
    await q.query(`ALTER TABLE "fin_journal_entries" DROP COLUMN "entry_type"`);
    await q.query(`ALTER TABLE "fin_chart_of_accounts" DROP CONSTRAINT "CHK_fin_chart_of_accounts_level"`);
    await q.query(`ALTER TABLE "fin_chart_of_accounts" DROP COLUMN "report_line"`);
    await q.query(`ALTER TABLE "fin_chart_of_accounts" DROP COLUMN "parent_code"`);
    await q.query(`ALTER TABLE "fin_chart_of_accounts" DROP COLUMN "level"`);
  }
}
