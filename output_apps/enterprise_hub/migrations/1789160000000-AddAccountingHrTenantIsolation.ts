import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * جداسازی مستأجر (Multi-Tenant) برای ماژول‌های Accounting و HR — Wave 2.
 *
 * این دو ماژول از طریق سند خودکار حقوق (HR → Accounting) به هم گره خورده‌اند و
 * بنابراین در یک Migration واحد مستأجرمند می‌شوند:
 *   • افزودن ستون `tenant_id` به همه جداول حسابداری (`fin_chart_of_accounts`،
 *     `fin_journal_entries`، `fin_journal_entry_lines`) و منابع انسانی
 *     (`hr_employees`، `hr_employment_contracts`، `hr_payslips`)؛
 *   • پرکردن ردیف‌های موجود با مستأجر پیش‌فرض و سپس NOT NULL کردن ستون؛
 *   • ساخت ایندکس‌های ترکیبی مسیر کوئری؛
 *   • تبدیل کلیدهای طبیعی یکتای سراسری (کد حساب، شماره سند، کد پرسنلی، کد ملی،
 *     شماره قرارداد، شماره فیش و دوره فیش) به یکتایی ترکیبی `(tenant_id, …)`.
 *
 * نام ایندکس‌های یکتای سراسری جداول مالی، همان نام تولیدشده توسط لایه مالی
 * پایتونی (SQLAlchemy) است (`ix_<table>_<column>`)، مطابق رویه Migration
 * `1789140000000-AddTenantsFoundation` که `ix_crm_leads_email` را حذف می‌کند.
 *
 * این Migration فقط از طریق PR بازبینی‌شده اعمال می‌شود و هرگز به
 * synchronize=true تکیه نمی‌کند (Rule #4 - AGENTS.md).
 */
export class AddAccountingHrTenantIsolation1789160000000
  implements MigrationInterface
{
  name = 'AddAccountingHrTenantIsolation1789160000000';

  /** شناسه ثابت مستأجر پیش‌فرض (همان مقدار backfill در 1789120000000). */
  private readonly defaultTenantId = '00000000-0000-0000-0000-000000000001';

  /** افزودن، پرکردن و الزامی‌کردن ستون `tenant_id` یک جدول. */
  private async addTenantColumn(
    queryRunner: QueryRunner,
    table: string,
  ): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "${table}" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL`,
      [this.defaultTenantId],
    );
    await queryRunner.query(
      `ALTER TABLE "${table}" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ==================================================================
    // حسابداری — fin_chart_of_accounts (دفتر کل حساب‌ها)
    // ==================================================================
    await this.addTenantColumn(queryRunner, 'fin_chart_of_accounts');
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_fin_chart_of_accounts_code"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_fin_chart_of_accounts_tenant_code" ON "fin_chart_of_accounts" ("tenant_id", "code")`,
    );

    // ==================================================================
    // حسابداری — fin_journal_entries (سرصفحه سند دفتر روزنامه)
    // ==================================================================
    await this.addTenantColumn(queryRunner, 'fin_journal_entries');
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_fin_journal_entries_entry_number"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_fin_journal_entries_tenant_entry_number" ON "fin_journal_entries" ("tenant_id", "entry_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_journal_entries_tenant_date" ON "fin_journal_entries" ("tenant_id", "date")`,
    );

    // ==================================================================
    // حسابداری — fin_journal_entry_lines (سطرهای بدهکار/بستانکار)
    // ==================================================================
    await this.addTenantColumn(queryRunner, 'fin_journal_entry_lines');
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_journal_entry_lines_tenant_account" ON "fin_journal_entry_lines" ("tenant_id", "account_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fin_journal_entry_lines_tenant_entry" ON "fin_journal_entry_lines" ("tenant_id", "journal_entry_id")`,
    );

    // ==================================================================
    // منابع انسانی — hr_employees (پرونده پرسنل)
    // ==================================================================
    await this.addTenantColumn(queryRunner, 'hr_employees');
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_hr_employees_employee_number"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_hr_employees_national_id"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_hr_employees_tenant_employee_number" ON "hr_employees" ("tenant_id", "employee_number")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_hr_employees_tenant_national_id" ON "hr_employees" ("tenant_id", "national_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_hr_employees_tenant_created_at" ON "hr_employees" ("tenant_id", "created_at")`,
    );

    // ==================================================================
    // منابع انسانی — hr_employment_contracts (احکام/قراردادها)
    // ==================================================================
    await this.addTenantColumn(queryRunner, 'hr_employment_contracts');
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_hr_employment_contracts_contract_number"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_hr_employment_contracts_tenant_contract_number" ON "hr_employment_contracts" ("tenant_id", "contract_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_hr_employment_contracts_tenant_employee_id" ON "hr_employment_contracts" ("tenant_id", "employee_id")`,
    );

    // ==================================================================
    // منابع انسانی — hr_payslips (فیش‌های حقوقی)
    // ==================================================================
    await this.addTenantColumn(queryRunner, 'hr_payslips');
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_hr_payslips_payslip_number"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_hr_payslips_tenant_payslip_number" ON "hr_payslips" ("tenant_id", "payslip_number")`,
    );
    await queryRunner.query(
      `ALTER TABLE "hr_payslips" DROP CONSTRAINT IF EXISTS "UQ_hr_payslips_employee_period"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hr_payslips" ADD CONSTRAINT "UQ_hr_payslips_tenant_employee_period" UNIQUE ("tenant_id", "employee_id", "period_year", "period_month")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ==================================================================
    // منابع انسانی — hr_payslips
    // ==================================================================
    await queryRunner.query(
      `ALTER TABLE "hr_payslips" DROP CONSTRAINT IF EXISTS "UQ_hr_payslips_tenant_employee_period"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hr_payslips" ADD CONSTRAINT "UQ_hr_payslips_employee_period" UNIQUE ("employee_id", "period_year", "period_month")`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_hr_payslips_tenant_payslip_number"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hr_payslips_payslip_number" ON "hr_payslips" ("payslip_number")`,
    );
    await queryRunner.query(
      `ALTER TABLE "hr_payslips" DROP COLUMN IF EXISTS "tenant_id"`,
    );

    // ==================================================================
    // منابع انسانی — hr_employment_contracts
    // ==================================================================
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_hr_employment_contracts_tenant_employee_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_hr_employment_contracts_tenant_contract_number"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hr_employment_contracts_contract_number" ON "hr_employment_contracts" ("contract_number")`,
    );
    await queryRunner.query(
      `ALTER TABLE "hr_employment_contracts" DROP COLUMN IF EXISTS "tenant_id"`,
    );

    // ==================================================================
    // منابع انسانی — hr_employees
    // ==================================================================
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_hr_employees_tenant_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_hr_employees_tenant_national_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_hr_employees_tenant_employee_number"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hr_employees_national_id" ON "hr_employees" ("national_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hr_employees_employee_number" ON "hr_employees" ("employee_number")`,
    );
    await queryRunner.query(
      `ALTER TABLE "hr_employees" DROP COLUMN IF EXISTS "tenant_id"`,
    );

    // ==================================================================
    // حسابداری — fin_journal_entry_lines
    // ==================================================================
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_fin_journal_entry_lines_tenant_entry"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_fin_journal_entry_lines_tenant_account"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fin_journal_entry_lines" DROP COLUMN IF EXISTS "tenant_id"`,
    );

    // ==================================================================
    // حسابداری — fin_journal_entries
    // ==================================================================
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_fin_journal_entries_tenant_date"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_fin_journal_entries_tenant_entry_number"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ix_fin_journal_entries_entry_number" ON "fin_journal_entries" ("entry_number")`,
    );
    await queryRunner.query(
      `ALTER TABLE "fin_journal_entries" DROP COLUMN IF EXISTS "tenant_id"`,
    );

    // ==================================================================
    // حسابداری — fin_chart_of_accounts
    // ==================================================================
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_fin_chart_of_accounts_tenant_code"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ix_fin_chart_of_accounts_code" ON "fin_chart_of_accounts" ("code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "fin_chart_of_accounts" DROP COLUMN IF EXISTS "tenant_id"`,
    );
  }
}