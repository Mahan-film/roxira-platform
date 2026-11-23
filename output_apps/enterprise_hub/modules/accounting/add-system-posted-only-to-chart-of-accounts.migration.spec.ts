import { QueryRunner } from 'typeorm';
import { AddSystemPostedOnlyToChartOfAccounts1789900034000 } from '../../migrations/1789900034000-AddSystemPostedOnlyToChartOfAccounts';

describe('AddSystemPostedOnlyToChartOfAccounts1789900034000', () => {
  let migration: AddSystemPostedOnlyToChartOfAccounts1789900034000;
  let queries: string[];
  let runner: QueryRunner;

  beforeEach(() => {
    migration = new AddSystemPostedOnlyToChartOfAccounts1789900034000();
    queries = [];
    runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return [];
      }),
    } as unknown as QueryRunner;
  });

  it('adds system_posted_only, adjustment_period_open, RLS-safe backfill, and partial index on up()', async () => {
    await migration.up(runner);

    const joined = queries.join('\n');
    expect(joined).toContain('SET LOCAL lock_timeout');
    expect(joined).toContain('ALTER TABLE "fin_chart_of_accounts"');
    expect(joined).toContain('ADD COLUMN IF NOT EXISTS "system_posted_only" boolean NOT NULL DEFAULT false');
    expect(joined).toContain('ALTER TABLE "fin_fiscal_years"');
    expect(joined).toContain('ADD COLUMN IF NOT EXISTS "adjustment_period_open" boolean NOT NULL DEFAULT false');
    expect(joined).toContain("set_config('app.tenant_id'");
    expect(joined).toContain('UPDATE "fin_chart_of_accounts"');
    expect(joined).toContain('RECEIVABLE');
    expect(joined).toContain('PAYABLE');
    expect(joined).toContain('INVENTORY');
    expect(joined).toContain('FIXED_ASSET');
    expect(joined).toContain('ACCUMULATED_DEPRECIATION');
    // Custom-chart safety: must not blindly match code '1110' without report_line
    expect(joined).not.toContain("'1110'");
    expect(joined).toContain('IDX_fin_chart_of_accounts_tenant_system_posted');
  });

  it('reversibly drops index and added columns on down()', async () => {
    await migration.down(runner);

    const joined = queries.join('\n');
    expect(joined).toContain('DROP INDEX IF EXISTS "IDX_fin_chart_of_accounts_tenant_system_posted"');
    expect(joined).toContain('DROP COLUMN IF EXISTS "adjustment_period_open"');
    expect(joined).toContain('DROP COLUMN IF EXISTS "system_posted_only"');
  });
});
