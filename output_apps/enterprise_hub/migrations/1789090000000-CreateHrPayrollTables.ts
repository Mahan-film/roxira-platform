import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ایجاد جداول ماژول منابع انسانی و حقوق و دستمزد (HR & Payroll).
 *
 * - `hr_employees`: پرونده پرسنل (کد پرسنلی و کد ملی یکتا).
 * - `hr_employment_contracts`: احکام/قراردادهای حقوقی و اجزای حقوق.
 * - `hr_payslips`: فیش‌های حقوقی ماهانه و اتصال به سند خودکار دفتر روزنامه.
 *
 * طبق Rule #4 AGENTS.md (Contract-First Synchronization) schema صریحاً از
 * طریق Migration ایجاد می‌شود و هرگز به synchronize=true تکیه نمی‌کنیم.
 */
export class CreateHrPayrollTables1789090000000 implements MigrationInterface {
  name = 'CreateHrPayrollTables1789090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // پرونده پرسنل
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "hr_employees" (
        "id" SERIAL NOT NULL,
        "employee_number" character varying(32) NOT NULL,
        "first_name" character varying(64) NOT NULL,
        "last_name" character varying(64) NOT NULL,
        "national_id" character varying(20) NOT NULL,
        "father_name" character varying(64),
        "birth_date" date,
        "gender" character varying(10) NOT NULL DEFAULT 'MALE',
        "mobile" character varying(20) NOT NULL,
        "email" character varying(120),
        "job_title" character varying(120) NOT NULL,
        "department" character varying(120) NOT NULL,
        "marital_status" character varying(20) NOT NULL DEFAULT 'SINGLE',
        "dependants" integer NOT NULL DEFAULT 0,
        "employee_status" character varying(20) NOT NULL DEFAULT 'ACTIVE',
        "hire_date" date NOT NULL,
        "termination_date" date,
        "bank_account_number" character varying(32),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hr_employees_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hr_employees_employee_number" ON "hr_employees" ("employee_number")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hr_employees_national_id" ON "hr_employees" ("national_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employees_first_name" ON "hr_employees" ("first_name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employees_last_name" ON "hr_employees" ("last_name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employees_mobile" ON "hr_employees" ("mobile")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employees_job_title" ON "hr_employees" ("job_title")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employees_department" ON "hr_employees" ("department")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employees_employee_status" ON "hr_employees" ("employee_status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employees_hire_date" ON "hr_employees" ("hire_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employees_created_at" ON "hr_employees" ("created_at")`,
    );

    // ------------------------------------------------------------------
    // احکام و قراردادهای حقوقی
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "hr_employment_contracts" (
        "id" SERIAL NOT NULL,
        "contract_number" character varying(64) NOT NULL,
        "employee_id" integer NOT NULL,
        "contract_type" character varying(20) NOT NULL DEFAULT 'PERMANENT',
        "start_date" date NOT NULL,
        "end_date" date,
        "job_title" character varying(120) NOT NULL,
        "department" character varying(120) NOT NULL,
        "base_salary" numeric(18,2) NOT NULL,
        "housing_allowance" numeric(18,2) NOT NULL DEFAULT 0,
        "food_allowance" numeric(18,2) NOT NULL DEFAULT 0,
        "child_allowance" numeric(18,2) NOT NULL DEFAULT 0,
        "insurance_rate" numeric(6,3) NOT NULL DEFAULT 0.07,
        "is_insurance_subject" boolean NOT NULL DEFAULT true,
        "status" character varying(20) NOT NULL DEFAULT 'ACTIVE',
        "description" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hr_employment_contracts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_hr_employment_contracts_employee"
          FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hr_employment_contracts_contract_number" ON "hr_employment_contracts" ("contract_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employment_contracts_employee_id" ON "hr_employment_contracts" ("employee_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employment_contracts_contract_type" ON "hr_employment_contracts" ("contract_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employment_contracts_start_date" ON "hr_employment_contracts" ("start_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employment_contracts_job_title" ON "hr_employment_contracts" ("job_title")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employment_contracts_department" ON "hr_employment_contracts" ("department")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employment_contracts_status" ON "hr_employment_contracts" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_employment_contracts_created_at" ON "hr_employment_contracts" ("created_at")`,
    );

    // ------------------------------------------------------------------
    // فیش‌های حقوقی
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "hr_payslips" (
        "id" SERIAL NOT NULL,
        "payslip_number" character varying(64) NOT NULL,
        "employee_id" integer NOT NULL,
        "contract_id" integer,
        "period_year" integer NOT NULL,
        "period_month" integer NOT NULL,
        "base_salary" numeric(18,2) NOT NULL,
        "housing_allowance" numeric(18,2) NOT NULL DEFAULT 0,
        "food_allowance" numeric(18,2) NOT NULL DEFAULT 0,
        "child_allowance" numeric(18,2) NOT NULL DEFAULT 0,
        "overtime_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "gross_pay" numeric(18,2) NOT NULL,
        "insurance_deduction" numeric(18,2) NOT NULL DEFAULT 0,
        "income_tax" numeric(18,2) NOT NULL DEFAULT 0,
        "other_deductions" numeric(18,2) NOT NULL DEFAULT 0,
        "net_pay" numeric(18,2) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'ISSUED',
        "journal_entry_id" integer,
        "journal_entry_number" character varying(64),
        "issued_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hr_payslips_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_hr_payslips_employee_period"
          UNIQUE ("employee_id", "period_year", "period_month"),
        CONSTRAINT "FK_hr_payslips_employee"
          FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_hr_payslips_contract"
          FOREIGN KEY ("contract_id") REFERENCES "hr_employment_contracts"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_hr_payslips_journal_entry"
          FOREIGN KEY ("journal_entry_id") REFERENCES "fin_journal_entries"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hr_payslips_payslip_number" ON "hr_payslips" ("payslip_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_payslips_employee_id" ON "hr_payslips" ("employee_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_payslips_contract_id" ON "hr_payslips" ("contract_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_payslips_period_year" ON "hr_payslips" ("period_year")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_payslips_period_month" ON "hr_payslips" ("period_month")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_payslips_status" ON "hr_payslips" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_payslips_journal_entry_id" ON "hr_payslips" ("journal_entry_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_payslips_issued_at" ON "hr_payslips" ("issued_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hr_payslips_created_at" ON "hr_payslips" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_payslips_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_payslips_issued_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hr_payslips_journal_entry_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_payslips_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_payslips_period_month"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_payslips_period_year"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_payslips_contract_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_payslips_employee_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_hr_payslips_payslip_number"`,
    );
    await queryRunner.query(`DROP TABLE "hr_payslips"`);

    await queryRunner.query(
      `DROP INDEX "public"."IDX_hr_employment_contracts_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hr_employment_contracts_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hr_employment_contracts_department"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hr_employment_contracts_job_title"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hr_employment_contracts_start_date"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hr_employment_contracts_contract_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hr_employment_contracts_employee_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_hr_employment_contracts_contract_number"`,
    );
    await queryRunner.query(`DROP TABLE "hr_employment_contracts"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_hr_employees_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_employees_hire_date"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hr_employees_employee_status"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_employees_department"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_employees_job_title"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_employees_mobile"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_employees_last_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_hr_employees_first_name"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_hr_employees_national_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_hr_employees_employee_number"`,
    );
    await queryRunner.query(`DROP TABLE "hr_employees"`);
  }
}
