import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, 'verify-extractor-output.mjs');
const SAMPLE = path.resolve(here, '..', '..', 'tools', 'windows-extractor', 'sample-output');
const SCRIPT = path.resolve(SAMPLE, '..', 'Extract-RoxiraTables.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-'));
const copySample = () => {
  const dir = tmp();
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return dir;
};
const run = (dir) => spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' });
const manifestOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const writeManifest = (dir, m) => fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const linesOf = (dir, file) => gunzipSync(fs.readFileSync(path.join(dir, file))).toString('utf8').trimEnd().split('\n');

test('sample-output/ verifies and reports its row counts', () => {
  const r = run(SAMPLE);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK: 3 tables, 6 rows/);
});

test('the PowerShell extractor parses without syntax errors', { skip: !hasPwsh && 'pwsh is not installed' }, () => {
  const literal = `'${SCRIPT.replace(/'/g, "''")}'`;
  const command = `$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile(${literal},[ref]$t,[ref]$e) > $null; if ($e.Count) { $e | ForEach-Object { Write-Output ($_.Extent.StartLineNumber.ToString() + ': ' + $_.Message) }; exit 1 }; exit 0`;
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout || r.stderr);
});

test('a flipped byte fails on the file hash', () => {
  const dir = copySample();
  const file = path.join(dir, 't1.ndjson.gz');
  const buf = fs.readFileSync(file);
  buf[10] ^= 0xff;
  fs.writeFileSync(file, buf);
  const r = run(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Kala: sha256 mismatch/);
});

test('a wrong row count fails with the exact counts', () => {
  const dir = copySample();
  const m = manifestOf(dir);
  m.tables[0].rows = 3;
  writeManifest(dir, m);
  const r = run(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Kala: manifest says 3 rows, t1\.ndjson\.gz has 2/);
});

test('an unsafe file name is refused before any file is read', () => {
  const dir = copySample();
  const m = manifestOf(dir);
  m.tables[0].file = '../x.ndjson';
  writeManifest(dir, m);
  const r = run(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unsafe file name/);
});

test('a decimal written as a JSON number is refused', () => {
  const dir = copySample();
  const objs = linesOf(dir, 't1.ndjson.gz').map((line) => JSON.parse(line));
  objs[0].price = 12000.5;
  const gz = gzipSync(Buffer.from(`${objs.map((o) => JSON.stringify(o)).join('\n')}\n`, 'utf8'));
  fs.writeFileSync(path.join(dir, 't1.ndjson.gz'), gz);
  const m = manifestOf(dir);
  m.tables.find((t) => t.file === 't1.ndjson.gz').sha256 = sha(gz);
  writeManifest(dir, m);
  const r = run(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /column price is a JSON number/);
});

test('the server transform reads sample-output/ and normalises Arabic ي/ك', async () => {
  const { transformManifest, rows } = await import('./transform.mjs');
  const out = tmp();
  const { tables, conn } = await transformManifest({ dir: SAMPLE, outDir: out, memoryLimit: '256MB' });
  assert.deepEqual(tables.map((t) => t.name), ['Kala', 'Acc', 'Doc']);
  const kala = await rows(conn, `SELECT name FROM read_parquet('${tables[0].parquet}') ORDER BY code`);
  assert.deepEqual(kala.map((r) => r.name), ['کیلو برنج', 'روغن یاری'], 'Arabic ي ك become Persian ی ک');
  const acc = await rows(conn, `SELECT title FROM read_parquet('${tables[1].parquet}') ORDER BY account_code`);
  assert.equal(acc[1].title, 'حساب شرکت پرداختنی');
  const doc = await rows(conn, `SELECT body, amount::VARCHAR AS amount FROM read_parquet('${tables[2].parquet}') ORDER BY doc_no`);
  assert.equal(doc[0].body, 'سطر اول سطر دوم', 'the embedded newline is normalised to one space');
  assert.equal(doc[0].amount, '1250.0000');
  const [{ c }] = await rows(conn, `SELECT count(*) AS c FROM read_parquet('${tables[0].parquet}') WHERE unit IS NULL`);
  assert.equal(Number(c), 1, 'the NULL survives the round trip');
});
