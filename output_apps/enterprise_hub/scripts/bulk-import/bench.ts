/**
 * Local benchmark for the bulk import: runs the real BulkImportRunner (the same code the worker runs)
 * against a throwaway PostgreSQL database and records throughput and peak memory.
 *
 *   node bench.js --file <path> --expect-rows <n> --pg-port <port> [--label name] [--keep]
 *
 * The file is read in place (a local object store rooted at its folder), so a 5 GB fixture is never
 * copied. Memory is sampled every 200 ms from inside the process (rss and heap); run the script under
 * `/usr/bin/time -l` for the kernel's own peak-RSS figure.
 */
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { CreateBulkImport1789470000000 } from '../../migrations/1789470000000-CreateBulkImport';
import { TenantScope } from '../../modules/access/services/tenant-scope';
import { BulkImportRepository } from '../../modules/data_import/bulk/bulk-import.repository';
import { BulkImportRunner } from '../../modules/data_import/bulk/bulk-import.runner';
import { LocalObjectStore } from '../../modules/data_import/bulk/storage/local-object-store';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) {
    if (fallback === undefined) throw new Error(`missing --${name}`);
    return fallback;
  }
  return process.argv[i + 1];
}

const MB = 1024 * 1024;

async function main(): Promise<void> {
  const file = path.resolve(arg('file'));
  const expectRows = Number(arg('expect-rows', '0'));
  const port = Number(arg('pg-port', '54390'));
  const label = arg('label', 'bench');
  const keep = process.argv.includes('--keep');
  const size = fs.statSync(file).size;
  const dbName = `bulk_bench_${label}_${process.pid}`.replace(/[^a-z0-9_]/gi, '_');
  const tenant = '33333333-3333-4333-8333-333333333333';

  const admin = await new DataSource({ type: 'postgres', host: '127.0.0.1', port, username: 'postgres', database: 'postgres' }).initialize();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const owner = await new DataSource({ type: 'postgres', host: '127.0.0.1', port, username: 'postgres', database: dbName }).initialize();
  const qr = owner.createQueryRunner();
  await new CreateBulkImport1789470000000().up(qr);
  await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bulk_bench_app') THEN CREATE ROLE bulk_bench_app LOGIN; END IF; END $$`);
  await owner.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO bulk_bench_app`);
  await qr.release();
  await owner.destroy();

  const app = await new DataSource({ type: 'postgres', host: '127.0.0.1', port, username: 'bulk_bench_app', database: dbName, extra: { max: 4 } }).initialize();
  const repo = new BulkImportRepository(new TenantScope(app), app);
  const store = new LocalObjectStore(path.dirname(file));
  const runner = new BulkImportRunner(repo, store);

  const jobId = randomUUID();
  await repo.createJob(tenant, {
    id: jobId,
    createdBy: 'bench',
    fileName: path.basename(file),
    sizeBytes: size,
    objectKey: path.basename(file),
    multipartId: null,
    driver: 'local',
    partBytes: 64 * MB,
  });
  await repo.update(tenant, jobId, { status: 'queued' });

  let peakRss = 0;
  let peakHeap = 0;
  let peakExternal = 0;
  const sample = setInterval(() => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
    peakExternal = Math.max(peakExternal, m.external + m.arrayBuffers);
  }, 200);
  const started = Date.now();
  const log = setInterval(async () => {
    const j = await repo.getJob(tenant, jobId);
    if (!j) return;
    const secs = (Date.now() - started) / 1000;
    console.error(
      `[${secs.toFixed(0)}s] rows=${j.rowsStaged.toLocaleString('en')} read=${(j.bytesRead / MB).toFixed(0)}MB rss=${(process.memoryUsage().rss / MB).toFixed(0)}MB heap=${(process.memoryUsage().heapUsed / MB).toFixed(0)}MB`,
    );
  }, 15_000);

  const outcome = await runner.run(tenant, jobId);
  const elapsed = (Date.now() - started) / 1000;
  clearInterval(sample);
  clearInterval(log);

  const job = (await repo.getJob(tenant, jobId))!;
  const stats = await new TenantScope(app).run(tenant, (m) =>
    m.query(`SELECT table_idx, count(*)::bigint AS n, min(row_no)::bigint AS lo, max(row_no)::bigint AS hi FROM bulk_import_rows WHERE job_id = $1 GROUP BY table_idx ORDER BY table_idx`, [jobId]),
  );
  const first = await repo.readRows(tenant, jobId, 0, 0, 1);
  const lastNo = Number(stats[0]?.hi ?? 0);
  const last = await repo.readRows(tenant, jobId, 0, Math.max(0, lastNo - 1), 1);
  const dbBytes = await admin.query(`SELECT pg_database_size('${dbName}')::bigint AS b`);

  const result = {
    label,
    file: path.basename(file),
    fileBytes: size,
    fileGB: +(size / 1024 ** 3).toFixed(2),
    outcome,
    status: job.status,
    error: job.error,
    seconds: +elapsed.toFixed(1),
    mbPerSecond: +(size / MB / elapsed).toFixed(1),
    rowsStaged: job.rowsStaged,
    rowsPerSecond: Math.round(job.rowsStaged / elapsed),
    expectRows,
    rowsMatch: expectRows === 0 ? null : job.rowsStaged === expectRows,
    tables: job.tables.map((t) => ({ name: t.name, rows: t.rows, columns: t.columns.length })),
    dbTableStats: stats.map((s: { table_idx: number; n: string; lo: string; hi: string }) => ({ idx: s.table_idx, n: Number(s.n), lo: Number(s.lo), hi: Number(s.hi), contiguous: Number(s.n) === Number(s.hi) - Number(s.lo) + 1 })),
    firstRow: first[0]?.cells.slice(0, 3),
    lastRow: last[0]?.cells.slice(0, 3),
    notes: job.notes,
    peakRssMB: +(peakRss / MB).toFixed(0),
    peakHeapMB: +(peakHeap / MB).toFixed(0),
    peakExternalMB: +(peakExternal / MB).toFixed(0),
    postgresDatabaseGB: +(Number(dbBytes[0].b) / 1024 ** 3).toFixed(2),
    node: process.version,
    nodeHeapLimitMB: +(require('v8').getHeapStatistics().heap_size_limit / MB).toFixed(0),
  };
  console.log(JSON.stringify(result, null, 2));

  await app.destroy();
  if (!keep) await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
