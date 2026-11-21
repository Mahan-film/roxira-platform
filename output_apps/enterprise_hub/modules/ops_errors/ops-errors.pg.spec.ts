import 'reflect-metadata';
import {
  createTestDatabase,
  describePg,
  TEST_T1,
  TEST_T2,
  TestDatabaseContext,
} from '../../test/support/test-pg';
import { PLATFORM_OPS_TENANT_ID } from './constants/ops-errors.constants';
import { OpsErrorEventsRepository } from './repositories/ops-error-events.repository';
import { buildEvent } from './ops-errors.util';

describePg('ops_error_events FORCE RLS and alert queries on real PostgreSQL (T199 / #1093)', () => {
  let db: TestDatabaseContext;
  let repo: OpsErrorEventsRepository;

  beforeAll(async () => {
    db = await createTestDatabase('ops_errors');
    // runs as roxira_app (NOSUPERUSER NOBYPASSRLS) through TenantScope, like production
    repo = new OpsErrorEventsRepository(db.scope, db.app);
  }, 120000);

  afterAll(async () => {
    await db?.cleanup();
  });

  const ev = (msg: string, route = '/v1/x') =>
    buildEvent(new TypeError(msg), { route, httpMethod: 'GET', status: 500, release: 'sha1' });

  it('enables and forces RLS on ops_error_events and blocks unscoped app access', async () => {
    const flags = await db.rawQuery<{ rls: boolean; force: boolean }>(
      `SELECT relrowsecurity AS rls, relforcerowsecurity AS force
         FROM pg_class WHERE relname = 'ops_error_events'`,
    );
    expect(flags).toEqual([{ rls: true, force: true }]);

    await repo.upsert(TEST_T1, ev('rls probe'));

    // Direct roxira_app query without app.tenant_id sees 0 rows and cannot insert
    const unscoped = await db.app.query(`SELECT id FROM ops_error_events`);
    expect(unscoped).toHaveLength(0);
    await expect(
      db.app.query(
        `INSERT INTO ops_error_events (tenant_id, fingerprint, day, source, error_class)
         VALUES ($1, 'unscoped-fp', CURRENT_DATE, 'backend', 'Error')`,
        [TEST_T1],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('isolates identical fingerprints across tenants and platform scope under FORCE RLS', async () => {
    const sharedErr = ev('shared boom 42');
    await repo.upsert(TEST_T1, sharedErr);
    await repo.upsert(TEST_T2, sharedErr);
    await repo.upsert(PLATFORM_OPS_TENANT_ID, sharedErr);

    const t1List = await repo.list(TEST_T1, 50, 0);
    const t2List = await repo.list(TEST_T2, 50, 0);
    const platformList = await repo.list(PLATFORM_OPS_TENANT_ID, 50, 0);

    expect(t1List.items.every((r) => r.tenantId === TEST_T1)).toBe(true);
    expect(t2List.items.every((r) => r.tenantId === TEST_T2)).toBe(true);
    expect(platformList.items.every((r) => r.tenantId === PLATFORM_OPS_TENANT_ID)).toBe(true);
    expect(t2List.total).toBe(1);
    expect(platformList.total).toBe(1);

    // Cross-tenant markAlerted and purgeOlderThan cannot touch TEST_T1 rows
    const t1Row = t1List.items.find((r) => r.sampleMessage === 'shared boom 42')!;
    await repo.markAlerted(TEST_T2, t1Row.id);
    const t1Unalerted = await repo.findNewUnalerted(TEST_T1, 50);
    expect(t1Unalerted.some((r) => r.id === t1Row.id)).toBe(true);

    await db.rawQuery(`UPDATE ops_error_events SET day = day - 60 WHERE id = $1`, [t1Row.id]);
    await repo.purgeOlderThan(TEST_T2, 30);
    const stillThere = await db.rawQuery(`SELECT id FROM ops_error_events WHERE id = $1`, [t1Row.id]);
    expect(stillThere).toHaveLength(1);

    // Clean up probe rows before functional assertions
    await db.rawQuery(`DELETE FROM ops_error_events`);
  });

  it('upserts by (tenant, fingerprint, day): one row, count increments, volatile ids collapse', async () => {
    for (const n of [111, 222, 333]) await repo.upsert(TEST_T1, ev(`cannot read item ${n}`));
    const rows = await db.rawQuery<{ count: number; hour_count: number }>(
      `SELECT count, hour_count FROM ops_error_events
        WHERE tenant_id = $1 AND sample_message LIKE 'cannot read item%'`,
      [TEST_T1],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
    expect(rows[0].hour_count).toBe(3);
  });

  it('separate fingerprints get separate rows; list is paginated newest first', async () => {
    await repo.upsert(TEST_T1, ev('another failure'));
    const page = await repo.list(TEST_T1, 1, 0);
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.items[0].sampleMessage).toBe('another failure');
    expect((await repo.list(TEST_T1, 10, 0, 'ai-core')).total).toBe(0);
  });

  it('reports new fingerprints once, and a 10x hourly jump as a spike once per hour', async () => {
    const fresh = await repo.findNewUnalerted(TEST_T1, 10);
    expect(fresh).toHaveLength(2);
    await repo.markAlerted(TEST_T1, fresh[0].id);
    expect(await repo.findNewUnalerted(TEST_T1, 10)).toHaveLength(1);

    // seed a spike: previous hour 1, this hour 12
    for (let i = 0; i < 12; i++) await repo.upsert(TEST_T1, ev('spiky'));
    await db.rawQuery(
      `UPDATE ops_error_events SET prev_hour_count = 1 WHERE tenant_id = $1 AND sample_message = 'spiky'`,
      [TEST_T1],
    );
    const spikes = await repo.findSpikes(TEST_T1, 10);
    expect(spikes.map((s) => s.sampleMessage)).toEqual(['spiky']);
    await repo.markSpikeAlerted(TEST_T1, spikes[0].id);
    expect(await repo.findSpikes(TEST_T1, 10)).toHaveLength(0);
  });

  it('a fingerprint seen on an earlier day is not new on a later day', async () => {
    await db.rawQuery(
      `UPDATE ops_error_events SET day = day - 1, alerted_at = now()
        WHERE tenant_id = $1 AND sample_message = 'another failure'`,
      [TEST_T1],
    );
    await repo.upsert(TEST_T1, ev('another failure'));
    const today = await db.rawQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM ops_error_events
        WHERE tenant_id = $1 AND sample_message = 'another failure'`,
      [TEST_T1],
    );
    expect(today[0].n).toBe(2);
    const fresh = (await repo.findNewUnalerted(TEST_T1, 50)).map((r) => r.sampleMessage);
    expect(fresh).not.toContain('another failure');
  });

  it('digest query, scanTenantIds and purge work under TenantScope', async () => {
    await db.rawQuery(
      `INSERT INTO tenants (id, name, slug, is_active)
       VALUES ($1, 'Test Tenant 1', 'test-tenant-ops-1', true)
       ON CONFLICT (id) DO UPDATE SET is_active = true`,
      [TEST_T1],
    );
    const ids = await repo.scanTenantIds();
    expect(ids).toContain(PLATFORM_OPS_TENANT_ID);
    expect(ids).toContain(TEST_T1);

    const top = await repo.topLast24h(TEST_T1, 10);
    expect(top[0].total).toBeGreaterThanOrEqual(12);
    await db.rawQuery(`UPDATE ops_error_events SET day = day - 60 WHERE tenant_id = $1`, [TEST_T1]);
    await repo.purgeOlderThan(TEST_T1, 30);
    expect(
      (await db.rawQuery<{ n: number }>(
        `SELECT count(*)::int AS n FROM ops_error_events WHERE tenant_id = $1`,
        [TEST_T1],
      ))[0].n,
    ).toBe(0);
  });
});
