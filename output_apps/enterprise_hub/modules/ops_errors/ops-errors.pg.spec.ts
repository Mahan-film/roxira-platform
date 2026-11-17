import 'reflect-metadata';
import { createTestDatabase, describePg, TestDatabaseContext } from '../../test/support/test-pg';
import { OpsErrorEventsRepository } from './repositories/ops-error-events.repository';
import { buildEvent } from './ops-errors.util';

describePg('ops_error_events upsert and alert queries on real PostgreSQL (T199)', () => {
  let db: TestDatabaseContext;
  let repo: OpsErrorEventsRepository;

  beforeAll(async () => {
    db = await createTestDatabase('ops_errors');
    // runs as roxira_app (NOSUPERUSER NOBYPASSRLS), like production
    repo = new OpsErrorEventsRepository(db.app);
  }, 120000);

  afterAll(async () => {
    await db?.cleanup();
  });

  const ev = (msg: string, route = '/v1/x') =>
    buildEvent(new TypeError(msg), { route, httpMethod: 'GET', status: 500, release: 'sha1' });

  it('upserts by fingerprint and day: one row, count increments, volatile ids collapse', async () => {
    for (const n of [111, 222, 333]) await repo.upsert(ev(`cannot read item ${n}`));
    const rows = await db.rawQuery(`SELECT count, hour_count FROM ops_error_events WHERE sample_message LIKE 'cannot read item%'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
    expect(rows[0].hour_count).toBe(3);
  });

  it('separate fingerprints get separate rows; list is paginated newest first', async () => {
    await repo.upsert(ev('another failure'));
    const page = await repo.list(1, 0);
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.items[0].sampleMessage).toBe('another failure');
    expect((await repo.list(10, 0, 'ai-core')).total).toBe(0);
  });

  it('reports new fingerprints once, and a 10x hourly jump as a spike once per hour', async () => {
    const fresh = await repo.findNewUnalerted(10);
    expect(fresh).toHaveLength(2);
    await repo.markAlerted(fresh[0].id);
    expect(await repo.findNewUnalerted(10)).toHaveLength(1);

    // seed a spike: previous hour 1, this hour 12
    for (let i = 0; i < 12; i++) await repo.upsert(ev('spiky'));
    await db.rawQuery(`UPDATE ops_error_events SET prev_hour_count = 1 WHERE sample_message = 'spiky'`);
    const spikes = await repo.findSpikes(10);
    expect(spikes.map((s) => s.sampleMessage)).toEqual(['spiky']);
    await repo.markSpikeAlerted(spikes[0].id);
    expect(await repo.findSpikes(10)).toHaveLength(0);
  });

  it('a fingerprint seen on an earlier day is not new on a later day', async () => {
    await db.rawQuery(`UPDATE ops_error_events SET day = day - 1, alerted_at = now() WHERE sample_message = 'another failure'`);
    await repo.upsert(ev('another failure'));
    const today = await db.rawQuery(`SELECT count(*)::int AS n FROM ops_error_events WHERE sample_message = 'another failure'`);
    expect(today[0].n).toBe(2);
    const fresh = (await repo.findNewUnalerted(50)).map((r) => r.sampleMessage);
    expect(fresh).not.toContain('another failure');
  });

  it('digest query and purge', async () => {
    const top = await repo.topLast24h(10);
    expect(top[0].total).toBeGreaterThanOrEqual(12);
    await db.rawQuery(`UPDATE ops_error_events SET day = day - 60`);
    await repo.purgeOlderThan(30);
    expect((await db.rawQuery(`SELECT count(*)::int AS n FROM ops_error_events`))[0].n).toBe(0);
  });
});
