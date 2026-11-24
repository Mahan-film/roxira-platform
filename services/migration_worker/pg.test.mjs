import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { discoverSchema } from './discover.mjs';
import { loadToPostgres, openDuck, schemaName, stageAll, stagingDdl } from './stage.mjs';
import { qstr, rows, transformManifest } from './transform.mjs';

const DSN = process.env.MIGRATION_TEST_PG_DSN;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const RLS_ROLE = 'mig_rls_test_app';

function bundle(tables) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-pg-src-'));
  const manifest = {
    version: 1,
    source: { kind: 'extractor', sqlMajor: 9, databaseName: 'PGTest', collation: null, createdAt: 'x' },
    tables: [],
  };
  tables.forEach((t, i) => {
    const gz = gzipSync(t.rows.map((r) => JSON.stringify(r)).join('\n') + (t.rows.length ? '\n' : ''));
    const file = `t${i + 1}.ndjson.gz`;
    fs.writeFileSync(path.join(dir, file), gz);
    manifest.tables.push({
      schema: 'dbo',
      name: t.name,
      rows: t.rows.length,
      file,
      sha256: createHash('sha256').update(gz).digest('hex'),
      columns: t.columns.map((name) => ({ name, type: 'nvarchar' })),
    });
  });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

async function pgExec(conn, sql) {
  await conn.run(`CALL postgres_execute('pg', ${qstr(sql)})`);
}

async function pgQuery(conn, sql) {
  return rows(conn, `SELECT * FROM postgres_query('pg', ${qstr(sql)})`);
}

test('PostgreSQL staging DDL, binary COPY loader, and FORCE RLS isolation', { skip: !DSN }, async () => {
  const { conn } = await openDuck();
  await conn.run('INSTALL postgres; LOAD postgres;');
  await conn.run(`ATTACH ${qstr(DSN)} AS pg (TYPE postgres);`);

  const s1 = schemaName(T1);
  const s2 = schemaName(T2);

  try {
    for (const tid of [T1, T2]) {
      for (const stmt of stagingDdl(tid).split(';\n').filter((s) => s.trim())) {
        await pgExec(conn, stmt);
      }
      const s = schemaName(tid);
      await pgExec(conn, `TRUNCATE ${s}.gl_trial_balance, ${s}.items, ${s}.open_items`);
    }

    const src1 = bundle([
      {
        name: 'تراز آزمایشی',
        columns: ['کد حساب', 'نام حساب', 'بدهکار', 'بستانکار'],
        rows: [
          { 'کد حساب': '1011', 'نام حساب': 'صندوق', 'بدهکار': '۵٬۰۰۰٬۰۰۰', 'بستانکار': '0' },
          { 'کد حساب': '2010', 'نام حساب': 'پرداختنی', 'بدهکار': '0', 'بستانکار': '9,000,000' },
        ],
      },
      {
        name: 'Kala',
        columns: ['کد کالا', 'نام کالا', 'واحد'],
        rows: [{ 'کد کالا': 'A1', 'نام کالا': 'برنج ایرانی', 'واحد': 'کیلو' }],
      },
      {
        name: 'OpenItems',
        columns: ['کد طرف حساب', 'شماره فاکتور', 'تاریخ', 'مبلغ'],
        rows: [{ 'کد طرف حساب': 'P1', 'شماره فاکتور': 'INV-1', 'تاریخ': '1403/05/12', 'مبلغ': '125000' }],
      },
    ]);
    const src2 = bundle([
      {
        name: 'Kala',
        columns: ['کد کالا', 'نام کالا', 'واحد'],
        rows: [{ 'کد کالا': 'B2', 'نام کالا': 'شکر', 'واحد': 'کیلو' }],
      },
    ]);

    const out1 = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-pg-out1-'));
    const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-pg-out2-'));

    const t1 = await transformManifest({ dir: src1, outDir: out1 });
    const m1 = await discoverSchema(t1.tables, async () => []);
    const st1 = await stageAll({ conn: t1.conn, tables: t1.tables, mappings: m1, outDir: out1 });
    assert.deepEqual(st1.report.staged, { gl_trial_balance: 2, items: 1, open_items: 1 });

    const t2 = await transformManifest({ dir: src2, outDir: out2 });
    const m2 = await discoverSchema(t2.tables, async () => []);
    const st2 = await stageAll({ conn: t2.conn, tables: t2.tables, mappings: m2, outDir: out2 });
    assert.deepEqual(st2.report.staged, { items: 1 });

    await loadToPostgres({ conn: t1.conn, tenantId: T1, stagedDir: st1.stagedDir, dsn: DSN });
    await loadToPostgres({ conn: t2.conn, tenantId: T2, stagedDir: st2.stagedDir, dsn: DSN });

    const [tbCount] = await pgQuery(conn, `SELECT count(*)::int AS n FROM ${s1}.gl_trial_balance WHERE tenant_id = '${T1}'`);
    const [item1Count] = await pgQuery(conn, `SELECT count(*)::int AS n FROM ${s1}.items WHERE tenant_id = '${T1}'`);
    const [oiCount] = await pgQuery(conn, `SELECT count(*)::int AS n FROM ${s1}.open_items WHERE tenant_id = '${T1}' AND date = '2024-08-02' AND date_raw = '1403/05/12'`);
    const [item2Count] = await pgQuery(conn, `SELECT count(*)::int AS n FROM ${s2}.items WHERE tenant_id = '${T2}'`);
    assert.equal(tbCount.n, 2);
    assert.equal(item1Count.n, 1);
    assert.equal(oiCount.n, 1);
    assert.equal(item2Count.n, 1);

    // Ensure non-superuser, NOBYPASSRLS role exists and has schema/table privileges
    await pgExec(
      conn,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_ROLE}') THEN CREATE ROLE ${RLS_ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOLOGIN; END IF; END $$`,
    );
    for (const s of [s1, s2]) {
      await pgExec(conn, `GRANT USAGE ON SCHEMA ${s} TO ${RLS_ROLE}`);
      await pgExec(conn, `GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA ${s} TO ${RLS_ROLE}`);
    }

    // Without app.tenant_id, non-superuser sees 0 rows (fail closed)
    await conn.run('BEGIN TRANSACTION');
    await pgExec(conn, `SET LOCAL ROLE ${RLS_ROLE}`);
    const [unscoped] = await pgQuery(conn, `SELECT count(*)::int AS n FROM ${s1}.items`);
    await conn.run('COMMIT');
    assert.equal(unscoped.n, 0);

    // With app.tenant_id = T1, non-superuser sees T1's rows and cannot see T2's rows
    await conn.run('BEGIN TRANSACTION');
    await pgExec(conn, `SET LOCAL ROLE ${RLS_ROLE}`);
    await pgExec(conn, `SET LOCAL app.tenant_id = '${T1}'`);
    const [aSeesA] = await pgQuery(conn, `SELECT count(*)::int AS n FROM ${s1}.items`);
    const [aSeesB] = await pgQuery(conn, `SELECT count(*)::int AS n FROM ${s2}.items`);
    assert.equal(aSeesA.n, 1);
    assert.equal(aSeesB.n, 0);

    // FORCE RLS WITH CHECK blocks inserting a row for tenant B while app.tenant_id = T1
    await assert.rejects(
      pgExec(conn, `INSERT INTO ${s1}.items (tenant_id, src_table, src_row, code, name) VALUES ('${T2}', 'Kala', 99, 'X', 'Bad')`),
      /row-level security policy/i,
    );
    await conn.run('ROLLBACK');
  } finally {
    await pgExec(conn, `DROP SCHEMA IF EXISTS ${s1} CASCADE`).catch(() => undefined);
    await pgExec(conn, `DROP SCHEMA IF EXISTS ${s2} CASCADE`).catch(() => undefined);
    await conn.run('DETACH pg').catch(() => undefined);
  }
});
