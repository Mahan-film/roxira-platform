import { AddAccountingHrTenantIsolation1789160000000 } from '../../migrations/1789160000000-AddAccountingHrTenantIsolation';

/** Runner ساختگی TypeORM که SQL اجراشده را ثبت می‌کند (بدون پایگاه‌داده). */
const createRunner = () => {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const runner = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      queries.push(sql);
      params.push(values ?? []);
      return undefined;
    }),
  };
  return { runner, queries, params };
};

describe('AddAccountingHrTenantIsolation migration', () => {
  it('exports a class exposing up() and down()', () => {
    const migration = new AddAccountingHrTenantIsolation1789160000000();
    expect(migration.name).toBe('AddAccountingHrTenantIsolation1789160000000');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('adds tenant_id, backfills and enforces NOT NULL on every accounting and HR table', async () => {
    const { runner, queries, params } = createRunner();
    await new AddAccountingHrTenantIsolation1789160000000().up(runner as never);

    const sql = queries.join('\n');
    const tables = [
      'fin_chart_of_accounts',
      'fin_journal_entries',
      'fin_journal_entry_lines',
      'hr_employees',
      'hr_employment_contracts',
      'hr_payslips',
    ];
    for (const table of tables) {
      expect(sql).toContain(
        `"${table}" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`,
      );
      expect(sql).toContain(
        `UPDATE "${table}" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL`,
      );
      expect(sql).toContain(
        `"${table}" ALTER COLUMN "tenant_id" SET NOT NULL`,
      );
    }
    expect(params.flat()).toContain('00000000-0000-0000-0000-000000000001');
  });

  it('creates the tenant query indexes for accounting and HR', async () => {
    const { runner, queries } = createRunner();
    await new AddAccountingHrTenantIsolation1789160000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'IDX_fin_chart_of_accounts_tenant_code',
    );
    expect(sql).toContain('("tenant_id", "code")');
    expect(sql).toContain('IDX_fin_journal_entries_tenant_date');
    expect(sql).toContain('("tenant_id", "date")');
    expect(sql).toContain('IDX_fin_journal_entry_lines_tenant_account');
    expect(sql).toContain('("tenant_id", "account_id")');
    expect(sql).toContain('IDX_hr_employees_tenant_created_at');
    expect(sql).toContain('("tenant_id", "created_at")');
    expect(sql).toContain('IDX_hr_employment_contracts_tenant_employee_id');
    expect(sql).toContain('("tenant_id", "employee_id")');
  });

  it('converts every global natural-key unique into a composite unique', async () => {
    const { runner, queries } = createRunner();
    await new AddAccountingHrTenantIsolation1789160000000().up(runner as never);

    const sql = queries.join('\n');
    // حسابداری — نام واقعی ایندکس‌های لایه مالی پایتونی (SQLAlchemy)
    expect(sql).toContain('DROP INDEX IF EXISTS "ix_fin_chart_of_accounts_code"');
    expect(sql).toContain(
      'IDX_fin_chart_of_accounts_tenant_code',
    );
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "ix_fin_journal_entries_entry_number"',
    );
    expect(sql).toContain('IDX_fin_journal_entries_tenant_entry_number');
    // منابع انسانی — نام ایندکس‌های صریح Migration 1789090000000
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "UQ_hr_employees_employee_number"',
    );
    expect(sql).toContain('DROP INDEX IF EXISTS "UQ_hr_employees_national_id"');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "UQ_hr_employment_contracts_contract_number"',
    );
    expect(sql).toContain('DROP INDEX IF EXISTS "UQ_hr_payslips_payslip_number"');
    expect(sql).toContain(
      'ALTER TABLE "hr_payslips" DROP CONSTRAINT IF EXISTS "UQ_hr_payslips_employee_period"',
    );
    expect(sql).toContain('UQ_hr_payslips_tenant_employee_period');
    expect(sql).toContain(
      'UNIQUE ("tenant_id", "employee_id", "period_year", "period_month")',
    );
  });

  it('down() restores the global uniques and drops tenant columns', async () => {
    const { runner, queries } = createRunner();
    await new AddAccountingHrTenantIsolation1789160000000().down(runner as never);

    const sql = queries.join('\n');
    const tables = [
      'fin_chart_of_accounts',
      'fin_journal_entries',
      'fin_journal_entry_lines',
      'hr_employees',
      'hr_employment_contracts',
      'hr_payslips',
    ];
    for (const table of tables) {
      expect(sql).toContain(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "tenant_id"`,
      );
    }
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ix_fin_chart_of_accounts_code"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ix_fin_journal_entries_entry_number"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hr_employees_employee_number"',
    );
    expect(sql).toContain(
      'ALTER TABLE "hr_payslips" ADD CONSTRAINT "UQ_hr_payslips_employee_period"',
    );
  });
});