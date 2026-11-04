import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { TARGETS } from './catalog.mjs';
import { discoverSchema, heuristicMap, maskSample, parseJsonAnswer, validateAnswer, litellmClient } from './discover.mjs';
import { ManifestError, parseManifest } from './manifest.mjs';
import { normalizeText, toIsoDate, sqlNormText } from './normalize.mjs';
import { loadToPostgres, schemaName, stageAll, stagingDdl } from './stage.mjs';
import { rows, sampleRows, transformManifest, openDuck } from './transform.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));

/** Writes NDJSON.gz files and a manifest the way the .bak pipeline / extractor do. */
function bundle(tables) {
  const dir = tmp();
  const m = { version: 1, source: { kind: 'extractor', sqlMajor: 9, databaseName: 'Holoo1', collation: null, createdAt: 'x' }, tables: [] };
  tables.forEach((t, i) => {
    const gz = gzipSync(t.rows.map((r) => JSON.stringify(r)).join('\n') + (t.rows.length ? '\n' : ''));
    const file = `t${i + 1}.ndjson.gz`;
    fs.writeFileSync(path.join(dir, file), gz);
    m.tables.push({ schema: 'dbo', name: t.name, rows: t.rows.length, file, sha256: createHash('sha256').update(gz).digest('hex'), columns: t.columns.map((name) => ({ name, type: 'nvarchar' })) });
  });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  return dir;
}

const TB = { name: 'تراز آزمایشی', columns: ['كد حساب', 'نام حساب', 'بدهكار', 'بستانكار'], rows: [
  { 'كد حساب': '1011', 'نام حساب': 'صندوق', 'بدهكار': '۵٬۰۰۰٬۰۰۰', 'بستانكار': '0' },
  { 'كد حساب': '2010', 'نام حساب': 'پرداختنی', 'بدهكار': '0', 'بستانكار': '9,000,000' },
  { 'كد حساب': '3010', 'نام حساب': 'سرمایه', 'بدهكار': '(500)', 'بستانكار': 'abc' },
] };
const ITEMS = { name: 'Kala', columns: ['کد کالا', 'نام کالا', 'واحد'], rows: [{ 'کد کالا': 'A1', 'نام کالا': 'برنج ایرانی', 'واحد': 'كيلو' }, { 'کد کالا': null, 'نام کالا': 'بی‌کد', 'واحد': 'عدد' }] };
const MYSTERY = { name: 'T7', columns: ['c_a', 'c_b', 'c_c', 'c_d'], rows: [{ c_a: '5', c_b: '1403/05/12', c_c: '۱۲٬۵۰۰', c_d: 'F-77' }, { c_a: '6', c_b: '1403/13/45', c_c: '10', c_d: 'F-78' }] };

test('normalisation: Arabic letters, tatweel, spaces and digits; SQL macro matches the JS function', async () => {
  assert.equal(normalizeText('  عليـ كريم  '), 'علی کریم');
  assert.equal(normalizeText(null), null);
  const { conn } = await openDuck();
  for (const s of ['كيك', 'a  b', ' ', 'زنجير‌ه', 'ﻙ', 'ياري']) {
    const [r] = await rows(conn, `SELECT ${sqlNormText(`'${s}'`)} AS v`);
    assert.equal(r.v, normalizeText(s) || null, JSON.stringify(s));
  }
});

test('dates: Jalali in several spellings, leap-year edge, Gregorian, junk', () => {
  assert.equal(toIsoDate('1403/05/12'), '2024-08-02');
  assert.equal(toIsoDate('۱۴۰۳-۰۱-۰۱'), '2024-03-20');
  assert.equal(toIsoDate('14030101'), '2024-03-20');
  assert.equal(toIsoDate('1403/12/30'), '2025-03-20'); // 1403 is a leap year
  assert.equal(toIsoDate('1404/12/30'), null); // 1404 is not
  assert.equal(toIsoDate('2024-08-02 10:30:00'), '2024-08-02');
  assert.equal(toIsoDate('1403/13/45'), null);
  assert.equal(toIsoDate('hello'), null);
});

test('manifest is validated as untrusted input', () => {
  const d = bundle([ITEMS]);
  const good = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
  assert.equal(parseManifest(good).tables.length, 1);
  assert.throws(() => parseManifest({ ...good, tables: [{ ...good.tables[0], file: '../x.ndjson' }] }), ManifestError);
  assert.throws(() => parseManifest({ version: 3 }), ManifestError);
});

test('end to end: verify, normalise to Parquet, discover, type, reject and count', async () => {
  const dir = bundle([TB, ITEMS, MYSTERY]);
  const out = tmp();
  const { tables, conn } = await transformManifest({ dir, outDir: out, memoryLimit: '512MB' });
  assert.equal(tables.length, 3);
  const [first] = await sampleRows(conn, tables[0].parquet, 5);
  assert.equal(first['كد حساب'], '1011');
  assert.equal(first['بدهكار'], '5٬۰۰۰٬۰۰۰'.replace('5', '۵'), 'text values are normalised, digits are left for the typed stage');

  let asked = 0;
  const ai = async (messages) => {
    asked += 1;
    assert.ok(!JSON.stringify(messages).includes('09123456789'));
    return 'Sure! ```json\n' + JSON.stringify({ target: 'open_items', fields: { party_code: 'c_a', date: 'c_b', amount: 'c_c', doc_no: 'c_d' }, confidence: 0.8 }) + '\n```';
  };
  const mappings = await discoverSchema(tables, (t) => sampleRows(conn, tables.find((x) => x.name === t.name).parquet, 5), ai);
  assert.equal(asked, 1, 'the AI is asked only about the table the heuristic could not place');
  assert.deepEqual(mappings.map((m) => [m.table, m.target, m.source]), [['تراز آزمایشی', 'gl_trial_balance', 'heuristic'], ['Kala', 'items', 'heuristic'], ['T7', 'open_items', 'ai']]);

  const { report, stagedDir } = await stageAll({ conn, tables, mappings, outDir: out });
  assert.deepEqual(report.staged, { gl_trial_balance: 2, items: 1, open_items: 2 });
  assert.deepEqual(report.rejected, { gl_trial_balance: 1, items: 1, open_items: 0 });
  const tb = await rows(conn, `SELECT account_code, debit::VARCHAR AS debit, credit::VARCHAR AS credit FROM read_parquet('${stagedDir}/gl_trial_balance__1.parquet') ORDER BY src_row`);
  assert.deepEqual(tb, [{ account_code: '1011', debit: '5000000.0000', credit: '0.0000' }, { account_code: '2010', debit: '0.0000', credit: '9000000.0000' }]);
  const open = await rows(conn, `SELECT amount::VARCHAR AS a, date::VARCHAR AS d, date_raw FROM read_parquet('${stagedDir}/open_items__3.parquet') ORDER BY src_row`);
  assert.deepEqual(open, [{ a: '12500.0000', d: '2024-08-02', date_raw: '1403/05/12' }, { a: '10.0000', d: null, date_raw: '1403/13/45' }]);
  const rej = await rows(conn, `SELECT src_table, src_row FROM read_parquet('${path.join(out, 'rejects')}/gl_trial_balance__1.parquet')`);
  assert.deepEqual(rej, [{ src_table: 'تراز آزمایشی', src_row: '3' }], 'the bad source row (cell "abc") is named, not dropped');
});

test('a tampered or truncated file is refused before anything is read', async () => {
  const dir = bundle([ITEMS]);
  fs.appendFileSync(path.join(dir, 't1.ndjson.gz'), 'x');
  await assert.rejects(transformManifest({ dir, outDir: tmp() }), /sha256 mismatch/);
  const d2 = bundle([ITEMS]);
  const m = JSON.parse(fs.readFileSync(path.join(d2, 'manifest.json'), 'utf8'));
  m.tables[0].rows = 5;
  fs.writeFileSync(path.join(d2, 'manifest.json'), JSON.stringify(m));
  await assert.rejects(transformManifest({ dir: d2, outDir: tmp() }), /manifest says 5 rows, read 2/);
});

test('an out-of-core run under a tiny memory limit stays correct (300k rows, 64 MB)', async () => {
  const many = Array.from({ length: 300_000 }, (_, i) => ({ code: `K${i}`, name: `كالا ${i}`, unit: 'عدد' }));
  const dir = bundle([{ name: 'items', columns: ['code', 'name', 'unit'], rows: many }]);
  const { tables, conn } = await transformManifest({ dir, outDir: tmp(), memoryLimit: '64MB', threads: 1 });
  const [r] = await rows(conn, `SELECT count(*) AS c, count(DISTINCT code) AS d FROM read_parquet('${tables[0].parquet}') WHERE name LIKE 'کالا %'`);
  assert.deepEqual(r, { c: '300000', d: '300000' });
});

test('heuristic placement and the AI guardrails', async () => {
  assert.equal(heuristicMap({ name: 'x', columns: ['foo', 'bar'] }).status, 'unmapped');
  assert.equal(heuristicMap(TB).target, 'gl_trial_balance');
  const t = { name: 'T', columns: ['a', 'b'] };
  assert.equal(validateAnswer(t, { target: 'items', fields: { code: 'a', name: 'zzz' } }).ok, false, 'hallucinated column');
  assert.equal(validateAnswer(t, { target: 'items', fields: { code: 'a' } }).ok, false, 'required field missing');
  assert.equal(validateAnswer(t, { target: 'items', fields: { code: 'a', name: 'a' } }).ok, false, 'column used twice');
  assert.equal(validateAnswer(t, { target: 'nope', fields: {} }).ok, false);
  assert.equal(validateAnswer(t, { target: 'items', fields: { code: 'a', name: 'b' }, confidence: 7 }).confidence, 1);
  assert.equal(parseJsonAnswer('no json'), null);
  const bad = await discoverSchema([{ name: 'T', rows: 1, columns: ['a', 'b'] }], async () => [], async () => '{"target":"items","fields":{"code":"nope","name":"b"}}');
  assert.equal(bad[0].status, 'needs-review');
  const none = await discoverSchema([{ name: 'T', rows: 1, columns: ['a', 'b'] }], async () => []);
  assert.equal(none[0].status, 'needs-review');
});

test('samples sent to the model are masked and truncated; the client never logs the key', async () => {
  assert.equal(maskSample('0912 and 09123456789 mail a.b@c.com'), '0912 and 09######### mail x@x.x');
  assert.equal(maskSample('x'.repeat(100)).length, 40);
  const calls = [];
  const client = litellmClient({ LITELLM_API_KEY: 'sk-secret', MIGRATION_LLM_MODELS: 'free,paid' }, async (url, init) => {
    calls.push(JSON.parse(init.body).model);
    return calls.length === 1 ? { ok: false, status: 429 } : { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) };
  });
  assert.equal(await client([{ role: 'user', content: 'x' }]), '{}');
  assert.deepEqual(calls, ['free', 'paid'], 'free model first, paid only as fallback');
});

test('staging DDL: per-tenant schema, tenant_id on every table, FORCE RLS; loader dry run', async () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
  assert.equal(schemaName(tenant), 'mig_11111111111141118111111111111111');
  assert.throws(() => schemaName("x'; drop schema public;--"));
  const ddl = stagingDdl(tenant);
  for (const t of Object.keys(TARGETS)) assert.ok(ddl.includes(`CREATE TABLE IF NOT EXISTS "mig_11111111111141118111111111111111"."${t}"`));
  assert.equal((ddl.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length, Object.keys(TARGETS).length);
  assert.equal((ddl.match(/"tenant_id" uuid NOT NULL/g) ?? []).length, Object.keys(TARGETS).length);
  const out = tmp();
  fs.mkdirSync(path.join(out, 'staged'));
  fs.writeFileSync(path.join(out, 'staged', 'items__2.parquet'), '');
  const { statements } = await loadToPostgres({ tenantId: tenant, stagedDir: path.join(out, 'staged'), dryRun: true });
  assert.ok(statements[1].startsWith('INSERT INTO pg."mig_11111111111141118111111111111111"."items"'));
  assert.ok(!statements.join('\n').includes('postgres://'), 'the DSN never appears in the plan');
});
