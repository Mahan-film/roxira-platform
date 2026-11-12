import { CreateTenantOnboardingProgress1789900002900 } from '../../migrations/1789900002900-CreateTenantOnboardingProgress';

const run = async (direction: 'up' | 'down') => {
  const queries: string[] = [];
  const runner = { query: jest.fn(async (sql: string) => void queries.push(sql)) };
  await new CreateTenantOnboardingProgress1789900002900()[direction](runner as never);
  return queries;
};

describe('CreateTenantOnboardingProgress migration (1789900002900)', () => {
  it('creates a tenant-keyed table and backfills existing tenants BEFORE enabling FORCE RLS', async () => {
    const queries = await run('up');
    const sql = queries.join('\n');
    const create = queries.findIndex((q) => q.includes('CREATE TABLE IF NOT EXISTS "tenant_onboarding_progress"'));
    const backfill = queries.findIndex((q) => q.includes('INSERT INTO "tenant_onboarding_progress"'));
    const force = queries.findIndex((q) => q.includes('FORCE ROW LEVEL SECURITY'));
    expect(queries[create]).toContain('"tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id")');
    expect(create).toBeLessThan(backfill);
    expect(backfill).toBeLessThan(force);
    expect(queries[backfill]).toContain('true, now()');
    expect(sql).toContain('CREATE POLICY "tenant_onboarding_progress_tenant" ON "tenant_onboarding_progress"');
    expect(sql).toContain('CHK_tenant_onboarding_economic_code');
    expect(sql).toContain('CHK_tenant_onboarding_national_id');
  });

  it('down() removes the policy and the table', async () => {
    const sql = (await run('down')).join('\n');
    expect(sql).toContain('DROP POLICY IF EXISTS "tenant_onboarding_progress_tenant"');
    expect(sql).toContain('DROP TABLE IF EXISTS "tenant_onboarding_progress"');
  });
});
