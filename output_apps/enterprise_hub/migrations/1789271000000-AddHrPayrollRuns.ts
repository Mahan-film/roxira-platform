import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payroll phase 2 (docs/strategy/ROXIRA_BUSINESS_SUITE_2026-10-22.md §4).
 *
 *   • New table `hr_payroll_runs`: one run per tenant per Jalali month, with
 *     `tenant_id` (access checks in HrRepository) and UNIQUE (tenant, period).
 *   • `hr_payslips`: run link + labour-law components (seniority, night,
 *     holiday, absence), employer/unemployment insurance and the inputs.
 *   • `hr_employees.insurance_number` for the social-security list export.
 *
 * Additive only: every new column is nullable or has a default, so existing
 * rows and the legacy single-payslip endpoint keep working.
 */
export class AddHrPayrollRuns1789271000000 implements MigrationInterface {
  name = 'AddHrPayrollRuns1789271000000';

  private static readonly PAYSLIP_MONEY_COLUMNS = [
    'seniority_amount',
    'night_shift_amount',
    'holiday_amount',
    'absence_deduction',
    'insurable_wage',
    'employer_insurance',
    'unemployment_insurance',
  ];

  private static readonly PAYSLIP_QUANTITY_COLUMNS = [
    'work_days',
    'overtime_hours',
    'night_hours',
    'holiday_hours',
    'absence_days',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "hr_payroll_runs" (
        "id" SERIAL NOT NULL,
        "tenant_id" uuid NOT NULL,
        "period_year" integer NOT NULL,
        "period_month" integer NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'DRAFT',
        "rates_year" integer NOT NULL,
        "employee_count" integer NOT NULL DEFAULT 0,
        "total_gross" numeric(18,2) NOT NULL DEFAULT 0,
        "total_insurable" numeric(18,2) NOT NULL DEFAULT 0,
        "total_employee_insurance" numeric(18,2) NOT NULL DEFAULT 0,
        "total_employer_insurance" numeric(18,2) NOT NULL DEFAULT 0,
        "total_unemployment_insurance" numeric(18,2) NOT NULL DEFAULT 0,
        "total_income_tax" numeric(18,2) NOT NULL DEFAULT 0,
        "total_other_deductions" numeric(18,2) NOT NULL DEFAULT 0,
        "total_net" numeric(18,2) NOT NULL DEFAULT 0,
        "journal_entry_id" integer,
        "journal_entry_number" character varying(64),
        "posted_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hr_payroll_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_hr_payroll_runs_tenant_period"
          UNIQUE ("tenant_id", "period_year", "period_month"),
        CONSTRAINT "FK_hr_payroll_runs_journal_entry"
          FOREIGN KEY ("journal_entry_id") REFERENCES "fin_journal_entries"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_hr_payroll_runs_tenant_id" ON "hr_payroll_runs" ("tenant_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "hr_payslips" ADD COLUMN IF NOT EXISTS "payroll_run_id" integer`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "hr_payslips" ADD CONSTRAINT "FK_hr_payslips_payroll_run"
          FOREIGN KEY ("payroll_run_id") REFERENCES "hr_payroll_runs"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_hr_payslips_tenant_payroll_run" ON "hr_payslips" ("tenant_id", "payroll_run_id")`,
    );
    for (const column of AddHrPayrollRuns1789271000000.PAYSLIP_MONEY_COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "hr_payslips" ADD COLUMN IF NOT EXISTS "${column}" numeric(18,2) NOT NULL DEFAULT 0`,
      );
    }
    for (const column of AddHrPayrollRuns1789271000000.PAYSLIP_QUANTITY_COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "hr_payslips" ADD COLUMN IF NOT EXISTS "${column}" numeric(8,2) NOT NULL DEFAULT 0`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "insurance_number" character varying(20)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hr_employees" DROP COLUMN IF EXISTS "insurance_number"`,
    );
    for (const column of [
      ...AddHrPayrollRuns1789271000000.PAYSLIP_QUANTITY_COLUMNS,
      ...AddHrPayrollRuns1789271000000.PAYSLIP_MONEY_COLUMNS,
    ]) {
      await queryRunner.query(
        `ALTER TABLE "hr_payslips" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_hr_payslips_tenant_payroll_run"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hr_payslips" DROP CONSTRAINT IF EXISTS "FK_hr_payslips_payroll_run"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hr_payslips" DROP COLUMN IF EXISTS "payroll_run_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "hr_payroll_runs"`);
  }
}
