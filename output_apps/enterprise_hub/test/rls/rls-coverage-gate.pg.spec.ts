/**
 * T192: scripts/dev/rls_coverage.sh against a database built by every migration.
 *  - the real schema passes the gate;
 *  - a tenant table without RLS, without FORCE or without a tenant policy fails it;
 *  - an unlisted table without tenant_id fails it (new global tables must be a conscious choice);
 *  - once protected with enableTenantRls(), roxira_app sees 0 rows of the other tenant.
 * Needs the `psql` client on PATH (CI runners have it). Locally without psql set
 * RLS_TEST_PSQL="docker exec -i <container> psql -h 127.0.0.1 -p <port> -U <user>" (the database is appended).
 * Skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import { spawnSync } from 'child_process';
import * as path from 'path';
import { enableTenantRls } from '../../migrations/data/tenant-rls';
import { createTestDatabase, describePg, PG_HOST, PG_PORT, ADMIN_USER, ADMIN_PASSWORD, APP_USER, TEST_T1, TEST_T2, TestDatabaseContext } from '../support/test-pg';

const SCRIPT = path.join(__dirname, '../../../../scripts/dev/rls_coverage.sh');

describePg('RLS coverage gate (scripts/dev/rls_coverage.sh)', () => {
  let ctx: TestDatabaseContext;

  beforeAll(async () => {
    ctx = await createTestDatabase('rlsgate');
  }, 300_000);
  afterAll(async () => ctx?.cleanup());

  const runGate = () => {
    const env: NodeJS.ProcessEnv = { ...process.env, PGHOST: PG_HOST, PGPORT: String(PG_PORT), PGUSER: ADMIN_USER, PGDATABASE: ctx.dbName };
    if (ADMIN_PASSWORD) env.PGPASSWORD = ADMIN_PASSWORD;
    if (process.env.RLS_TEST_PSQL) env.RLS_PSQL = `${process.env.RLS_TEST_PSQL} -d ${ctx.dbName}`;
    const r = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('passes on the fully migrated schema', () => {
    const r = runGate();
    expect(r.out).toContain('rls-coverage: OK');
    expect(r.code).toBe(0);
  });

  it('fails for a tenant table without RLS, then FORCE, then a tenant policy', async () => {
    await ctx.rawQuery(`CREATE TABLE gate_probe (id serial PRIMARY KEY, tenant_id uuid NOT NULL, note text)`);
    let r = runGate();
    expect(r.code).toBe(1);
    expect(r.out).toContain('FAIL gate_probe | tenant_id table lacks ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY, a policy referencing app.tenant_id');

    await ctx.rawQuery(`ALTER TABLE gate_probe ENABLE ROW LEVEL SECURITY`);
    r = runGate();
    expect(r.out).toContain('FAIL gate_probe | tenant_id table lacks FORCE ROW LEVEL SECURITY, a policy referencing app.tenant_id');

    await ctx.rawQuery(`ALTER TABLE gate_probe FORCE ROW LEVEL SECURITY`);
    await ctx.rawQuery(`CREATE POLICY gate_probe_open ON gate_probe USING (true)`);
    r = runGate();
    expect(r.out).toContain('FAIL gate_probe | tenant_id table lacks a policy referencing app.tenant_id');

    await ctx.rawQuery(`DROP POLICY gate_probe_open ON gate_probe`);
    await ctx.owner.transaction(async (m) => enableTenantRls(m.queryRunner!, 'gate_probe'));
    r = runGate();
    expect(r.code).toBe(0);
  });

  it('roxira_app reads 0 rows of another tenant from the protected table', async () => {
    await ctx.rawQuery(`GRANT SELECT, INSERT ON gate_probe TO ${APP_USER}`);
    await ctx.rawQuery(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_USER}`);
    await ctx.scope.run(TEST_T1, (m) => m.query(`INSERT INTO gate_probe (tenant_id, note) VALUES ($1, 'a')`, [TEST_T1]));
    const own = await ctx.scope.run(TEST_T1, (m) => m.query(`SELECT * FROM gate_probe`));
    const other = await ctx.scope.run(TEST_T2, (m) => m.query(`SELECT * FROM gate_probe`));
    expect(own).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it('fails for an unlisted table without tenant_id', async () => {
    await ctx.rawQuery(`CREATE TABLE gate_global (id serial PRIMARY KEY)`);
    const r = runGate();
    expect(r.code).toBe(1);
    expect(r.out).toContain('FAIL gate_global | no tenant_id column and not in scripts/dev/rls_allowlist.txt');
  });
});
