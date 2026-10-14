import { AddTenantsFoundation1789140000000 } from '../../migrations/1789140000000-AddTenantsFoundation';

/** Runner ساختگی TypeORM که SQL اجراشده را ثبت می‌کند (بدون پایگاه‌داده). */
const createRunner = () => {
  const queries: string[] = [];
  const runner = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return undefined;
    }),
  };
  return { runner, queries };
};

describe('AddTenantsFoundation migration', () => {
  it('exports a class exposing up() and down()', () => {
    const migration = new AddTenantsFoundation1789140000000();
    expect(migration.name).toBe('AddTenantsFoundation1789140000000');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('creates the tenants table and seeds the default tenant', async () => {
    const { runner, queries } = createRunner();
    await new AddTenantsFoundation1789140000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('CREATE TABLE "tenants"');
    expect(sql).toContain('IDX_tenants_slug');
    expect(sql).toContain('Roxira');
    expect(sql).toContain('roxira');
    expect(sql).toContain('ON CONFLICT ("id") DO NOTHING');
  });

  it('adds nullable tenant columns to users and backfills ADMIN users', async () => {
    const { runner, queries } = createRunner();
    await new AddTenantsFoundation1789140000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('"users" ADD COLUMN IF NOT EXISTS "tenant_id"');
    expect(sql).toContain('"users" ADD COLUMN IF NOT EXISTS "tenant_role"');
    expect(sql).toContain('IDX_users_tenant_id');
    expect(sql).toContain('WHERE "role" = \'ADMIN\'');
    expect(sql).not.toContain('SET NOT NULL');
  });

  it('widens the crm_leads email unique index to (tenant_id, email)', async () => {
    const { runner, queries } = createRunner();
    await new AddTenantsFoundation1789140000000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('DROP INDEX IF EXISTS "ix_crm_leads_email"');
    expect(sql).toContain('IDX_crm_leads_tenant_email');
    expect(sql).toContain('("tenant_id", "email")');
  });

  it('down() reverses every change', async () => {
    const { runner, queries } = createRunner();
    await new AddTenantsFoundation1789140000000().down(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_crm_leads_tenant_email"');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ix_crm_leads_email"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "tenant_role"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "tenant_id"');
    expect(sql).toContain('DROP TABLE IF EXISTS "tenants"');
  });
});
