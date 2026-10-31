import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Contract allowances with their own tax treatment, and what cumulative wage tax needs on each
 * payslip. `taxable_income` is backfilled for existing payslips with the only rule they were
 * calculated under: gross minus the employee insurance share. Additive.
 */
export class AddPayrollAllowancesAndCumulativeTax1789411000000 implements MigrationInterface {
  name = 'AddPayrollAllowancesAndCumulativeTax1789411000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "hr_contract_allowances" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "contract_id" integer NOT NULL,
        "title" character varying(120) NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "insurable" boolean NOT NULL DEFAULT true,
        "tax_treatment" character varying(16) NOT NULL DEFAULT 'PROGRESSIVE',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_hr_contract_allowances_amount" CHECK ("amount" >= 0),
        CONSTRAINT "CHK_hr_contract_allowances_tax"
          CHECK ("tax_treatment" IN ('PROGRESSIVE','FLAT','EXEMPT','NON_CASH')),
        CONSTRAINT "FK_hr_contract_allowances_contract" FOREIGN KEY ("contract_id")
          REFERENCES "hr_employment_contracts"("id") ON DELETE CASCADE
      )`);
    await q.query(
      `CREATE INDEX "IDX_hr_contract_allowances_contract" ON "hr_contract_allowances" ("tenant_id", "contract_id")`,
    );

    await q.query(
      `ALTER TABLE "hr_employment_contracts" ADD COLUMN "tax_regime" character varying(16) NOT NULL DEFAULT 'STANDARD'`,
    );
    await q.query(
      `ALTER TABLE "hr_employment_contracts" ADD CONSTRAINT "CHK_hr_employment_contracts_tax_regime"
         CHECK ("tax_regime" IN ('STANDARD','FLAT'))`,
    );

    await q.query(`
      ALTER TABLE "hr_payslips"
        ADD COLUMN "marriage_allowance" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN "allowances_total" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN "allowance_lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN "eidi_amount" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN "non_cash_amount" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN "taxable_income" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN "flat_tax" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN "month_days" integer NOT NULL DEFAULT 30`);
    await q.query(
      `UPDATE "hr_payslips" SET "taxable_income" = GREATEST(0, "gross_pay" - "insurance_deduction")`,
    );

    await q.query(`
      ALTER TABLE "hr_payroll_runs"
        ADD COLUMN "rates_snapshot" jsonb,
        ADD COLUMN "unverified_keys" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "hr_payroll_runs" DROP COLUMN "unverified_keys", DROP COLUMN "rates_snapshot"`);
    await q.query(`
      ALTER TABLE "hr_payslips"
        DROP COLUMN "month_days", DROP COLUMN "flat_tax", DROP COLUMN "taxable_income",
        DROP COLUMN "non_cash_amount", DROP COLUMN "eidi_amount", DROP COLUMN "allowance_lines",
        DROP COLUMN "allowances_total", DROP COLUMN "marriage_allowance"`);
    await q.query(`ALTER TABLE "hr_employment_contracts" DROP CONSTRAINT "CHK_hr_employment_contracts_tax_regime"`);
    await q.query(`ALTER TABLE "hr_employment_contracts" DROP COLUMN "tax_regime"`);
    await q.query(`DROP TABLE "hr_contract_allowances"`);
  }
}
