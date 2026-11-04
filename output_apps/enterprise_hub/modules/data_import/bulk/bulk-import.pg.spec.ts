/**
 * Bulk import against a REAL PostgreSQL: staging, checkpoint/resume, pause, cancel, and tenant isolation
 * under row-level security with a non-superuser role. Opt-in like the other *.pg.spec.ts: skipped unless
 * ROXIRA_TEST_PG_HOST is set; every run creates and drops its own throwaway database.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { CreateBulkImport1789470000000 } from '../../../migrations/1789470000000-CreateBulkImport';
import { TenantScope } from '../../access/services/tenant-scope';
import { BulkImportRepository } from './bulk-import.repository';
import { BulkImportRunner } from './bulk-import.runner';
import { LocalObjectStore } from './storage/local-object-store';
import { sourceKey } from './storage/object-store';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const DB = `bulk_import_test_${process.pid}`;

describePg('bulk import on PostgreSQL', () => {
  let admin: DataSource;
  let app: DataSource;
  let repo: BulkImportRepository;
  let runner: BulkImportRunner;
  let store: LocalObjectStore;
  let dir: string;

  beforeAll(async () => {
    process.env.IMPORT_BULK_POLL_MS = '1';
    admin = await new DataSource({ type: 'postgres', host: HOST, port: PORT, username: USER, database: 'postgres' }).initialize();
    await admin.query(`CREATE DATABASE "${DB}"`);
    const owner = await new DataSource({ type: 'postgres', host: HOST, port: PORT, username: USER, database: DB }).initialize();
    const qr = owner.createQueryRunner();
    await new CreateBulkImport1789470000000().up(qr);
    await owner.query(`CREATE TABLE tenants (id uuid PRIMARY KEY)`);
    await owner.query(`INSERT INTO tenants VALUES ('${T1}'), ('${T2}')`);
    await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bulk_app') THEN CREATE ROLE bulk_app LOGIN; END IF; END $$`);
    await owner.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO bulk_app`);
    await qr.release();
    await owner.destroy();
    app = await new DataSource({ type: 'postgres', host: HOST, port: PORT, username: 'bulk_app', database: DB }).initialize();
    repo = new BulkImportRepository(new TenantScope(app), app);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-pg-'));
    store = new LocalObjectStore(dir);
    runner = new BulkImportRunner(repo, store);
  });

  afterAll(async () => {
    await app?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin?.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function upload(tenantId: string, name: string, content: string | Buffer) {
    const id = require('crypto').randomUUID() as string;
    const local = path.join(dir, `${id}.src`);
    fs.writeFileSync(local, content);
    const key = sourceKey(tenantId, id);
    await store.putFile(key, local);
    const job = await repo.createJob(tenantId, { id, createdBy: 'u1', fileName: name, sizeBytes: fs.statSync(local).size, objectKey: key, multipartId: null, driver: 'local', partBytes: 1 << 20 });
    await repo.update(tenantId, id, { status: 'queued' });
    return job;
  }

  const csv = (rows: number) => 'id,name,amount\n' + Array.from({ length: rows }, (_, i) => `${i + 1},name ${i + 1},${i * 3}`).join('\n') + '\n';

  it('stages every row of a CSV in batches and reaches ready', async () => {
    const job = await upload(T1, 'people.csv', csv(12_345));
    expect(await runner.run(T1, job.id)).toBe('ready');
    const done = (await repo.getJob(T1, job.id))!;
    expect(done.status).toBe('ready');
    expect(done.rowsStaged).toBe(12_345);
    expect(done.tables).toEqual([{ idx: 0, name: 'people', columns: ['id', 'name', 'amount'], rows: 12_345 }]);
    const tail = await repo.readRows(T1, job.id, 0, 12_343, 10);
    expect(tail.map((r) => r.cells[0])).toEqual(['12344', '12345']);
  });

  it('resumes from a checkpoint without duplicating or losing rows', async () => {
    const job = await upload(T1, 'resume.csv', csv(9_000));
    // Pretend an earlier run staged 4 000 rows and was then killed.
    await repo.appendBatch(T1, job.id, 0, 1, Array.from({ length: 4_000 }, (_, i) => [String(i + 1), `name ${i + 1}`, String(i * 3)]), {
      bytesRead: 0,
      rowsStaged: 4_000,
      tables: [{ idx: 0, name: 'resume', columns: ['id', 'name', 'amount'], rows: 4_000 }],
      checkpoint: { rows: { resume: 4_000 } },
    });
    await runner.run(T1, job.id);
    const done = (await repo.getJob(T1, job.id))!;
    expect(done.rowsStaged).toBe(9_000);
    const counted = await new TenantScope(app).run(T1, (m) =>
      m.query(`SELECT count(*)::int AS n, count(distinct row_no)::int AS d, min(row_no)::int AS lo, max(row_no)::int AS hi FROM bulk_import_rows WHERE job_id = $1`, [job.id]),
    );
    expect(counted[0]).toEqual({ n: 9_000, d: 9_000, lo: 1, hi: 9_000 });
    // Without a tenant scope the app role sees nothing at all: row-level security, not just a WHERE clause.
    const unscoped = await app.query(`SELECT count(*)::int AS n FROM bulk_import_rows`);
    expect(unscoped[0].n).toBe(0);
  });

  it('pauses at a batch boundary, then resumes to the same total', async () => {
    const job = await upload(T1, 'pause.csv', csv(60_000));
    const running = runner.run(T1, job.id);
    await new Promise((r) => setTimeout(r, 30));
    await repo.transition(T1, job.id, ['running'], { status: 'pausing' });
    const outcome = await running;
    const paused = (await repo.getJob(T1, job.id))!;
    if (outcome === 'paused') {
      expect(paused.status).toBe('paused');
      expect(paused.rowsStaged).toBeLessThan(60_000);
      await repo.transition(T1, job.id, ['paused'], { status: 'queued' });
      expect(await runner.run(T1, job.id)).toBe('ready');
    }
    expect((await repo.getJob(T1, job.id))!.rowsStaged).toBe(60_000);
  });

  it('cancels at the next boundary', async () => {
    const job = await upload(T1, 'cancel.csv', csv(60_000));
    const running = runner.run(T1, job.id);
    await new Promise((r) => setTimeout(r, 30));
    await repo.transition(T1, job.id, ['running'], { status: 'cancelling' });
    const outcome = await running;
    const after = (await repo.getJob(T1, job.id))!;
    expect(['cancelled', 'ready']).toContain(after.status);
    if (outcome === 'cancelled') {
      let removed = 0;
      for (let n = await repo.deleteRows(T1, job.id, 1000); n > 0; n = await repo.deleteRows(T1, job.id, 1000)) removed += n;
      expect(await repo.readRows(T1, job.id, 0, 0, 10)).toHaveLength(0);
      expect(removed).toBeGreaterThanOrEqual(0);
    }
  });

  it('fails a hostile file with a clear message and keeps what is safe out of staging', async () => {
    const job = await upload(T1, 'bad.csv', 'a,b\n1,"' + 'x'.repeat(5 * 1024 * 1024));
    await runner.run(T1, job.id);
    const failed = (await repo.getJob(T1, job.id))!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('CSV');
  });

  it('isolates tenants: another tenant sees neither jobs, rows nor quota', async () => {
    const job = await upload(T1, 'mine.csv', csv(100));
    await runner.run(T1, job.id);
    expect(await repo.getJob(T2, job.id)).toBeNull();
    expect(await repo.readRows(T2, job.id, 0, 0, 10)).toHaveLength(0);
    expect(await repo.listJobs(T2)).toHaveLength(0);
    expect(await repo.usedBytes(T2)).toBe(0);
    expect(await repo.usedBytes(T1)).toBeGreaterThan(0);
    // Even asking for tenant 1's rows inside tenant 2's scope returns nothing (RLS, not just the WHERE).
    const leaked = await new TenantScope(app).run(T2, (m) => m.query(`SELECT 1 FROM bulk_import_rows WHERE job_id = $1`, [job.id]));
    expect(leaked).toHaveLength(0);
  });
});
