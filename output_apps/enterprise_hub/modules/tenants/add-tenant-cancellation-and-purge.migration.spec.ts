import { AddTenantCancellationAndPurge1789900008000 } from '../../migrations/1789900008000-AddTenantCancellationAndPurge';

const createRunner = () => {
  const queries: string[] = [];
  return { queries, runner: { query: jest.fn(async (sql: string) => void queries.push(sql)) } };
};

describe('AddTenantCancellationAndPurge migration (1789900008000)', () => {
  it('up() adds status, delete_after, cancelled_at, cancellation_reason, purged_at to tenants', async () => {
    const { runner, queries } = createRunner();
    await new AddTenantCancellationAndPurge1789900008000().up(runner as never);
    const sql = queries.join('\n');

    expect(sql).toContain('ALTER TABLE "tenants"');
    expect(sql).toContain('"status" character varying(32) NOT NULL DEFAULT \'active\'');
    expect(sql).toContain('"delete_after" TIMESTAMP WITH TIME ZONE NULL');
    expect(sql).toContain('"cancelled_at" TIMESTAMP WITH TIME ZONE NULL');
    expect(sql).toContain('"cancellation_reason" text NULL');
    expect(sql).toContain('"purged_at" TIMESTAMP WITH TIME ZONE NULL');
    expect(sql).toContain('CHK_tenants_status');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_tenants_status_delete_after"');
  });

  it('down() safely drops created columns, constraints, and index', async () => {
    const { runner, queries } = createRunner();
    await new AddTenantCancellationAndPurge1789900008000().down(runner as never);
    const sql = queries.join('\n');

    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_tenants_status_delete_after";');
    expect(sql).toContain('ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "CHK_tenants_status";');
    expect(sql).toContain('DROP COLUMN IF EXISTS "status"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "delete_after"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "purged_at"');
  });
});
