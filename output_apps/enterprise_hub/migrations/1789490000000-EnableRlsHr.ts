import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * Row-level security for HR and payroll (RLS rollout batch 3).
 *
 * HrRepository runs every query through TenantScope (also on a caller's transaction), and it is the
 * only code that touches these tables. Reversible; no data is touched.
 */
const TABLES = [
  'hr_employees',
  'hr_employment_contracts',
  'hr_contract_allowances',
  'hr_payroll_runs',
  'hr_payslips',
];

export class EnableRlsHr1789490000000 implements MigrationInterface {
  name = 'EnableRlsHr1789490000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of TABLES) await enableTenantRls(q, table);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...TABLES].reverse()) await disableTenantRls(q, table);
  }
}
