import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { rows, transformManifest } from './transform.mjs';
import { verifyExtractorOutput } from './verify-extractor-output.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const SAMPLE_DIR = path.join(REPO_ROOT, 'tools/windows-extractor/sample-output');
const VERIFIER_CLI = path.join(HERE, 'verify-extractor-output.mjs');
const EXTRACTOR_PS1 = path.join(REPO_ROOT, 'tools/windows-extractor/Extract-RoxiraTables.ps1');

function copySampleToTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-qa-'));
  for (const name of fs.readdirSync(SAMPLE_DIR)) {
    fs.copyFileSync(path.join(SAMPLE_DIR, name), path.join(dir, name));
  }
  return dir;
}

function runVerifierCli(dir) {
  return execFileSync(process.execPath, [VERIFIER_CLI, dir], { encoding: 'utf8' });
}

function runVerifierCliExpectFail(dir) {
  try {
    runVerifierCli(dir);
    assert.fail('expected verify-extractor-output.mjs to exit non-zero');
  } catch (err) {
    assert.notEqual(err.status, 0);
    return String(err.stderr || err.message);
  }
}

test('verify-extractor-output CLI passes on committed sample-output/', async () => {
  const stdout = runVerifierCli(SAMPLE_DIR);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tables.length, 3);

  const summary = await verifyExtractorOutput(SAMPLE_DIR);
  assert.equal(summary.tables.length, 3);
});

test('verify-extractor-output CLI rejects a flipped byte, wrong row count, path traversal, and numeric decimal', () => {
  // 1. Flipped byte in gzipped NDJSON
  const dFlipped = copySampleToTemp();
  const gzPath = path.join(dFlipped, 't1.ndjson.gz');
  const buf = fs.readFileSync(gzPath);
  buf[buf.length - 1] ^= 0xff;
  fs.writeFileSync(gzPath, buf);
  const errFlipped = runVerifierCliExpectFail(dFlipped);
  assert.match(errFlipped, /sha256 mismatch/);

  // 2. Wrong row count in manifest
  const dRows = copySampleToTemp();
  const mRows = JSON.parse(fs.readFileSync(path.join(dRows, 'manifest.json'), 'utf8'));
  mRows.tables[0].rows += 1;
  fs.writeFileSync(path.join(dRows, 'manifest.json'), JSON.stringify(mRows));
  const errRows = runVerifierCliExpectFail(dRows);
  assert.match(errRows, /row count mismatch/);

  // 3. Unsafe path traversal filename (../x.ndjson)
  const dPath = copySampleToTemp();
  const mPath = JSON.parse(fs.readFileSync(path.join(dPath, 'manifest.json'), 'utf8'));
  mPath.tables[0].file = '../x.ndjson';
  fs.writeFileSync(path.join(dPath, 'manifest.json'), JSON.stringify(mPath));
  const errPath = runVerifierCliExpectFail(dPath);
  assert.match(errPath, /unsafe file name/);

  // 4. Decimal column written as a JSON number instead of a JSON string (with valid sha256)
  const dNum = copySampleToTemp();
  const lines = gunzipSync(fs.readFileSync(path.join(dNum, 't1.ndjson.gz')))
    .toString('utf8')
    .trimEnd()
    .split('\n');
  const firstRow = JSON.parse(lines[0]);
  firstRow.price = 1250000;
  lines[0] = JSON.stringify(firstRow);
  const badGz = gzipSync(Buffer.from(lines.join('\n') + '\n', 'utf8'));
  fs.writeFileSync(path.join(dNum, 't1.ndjson.gz'), badGz);
  const mNum = JSON.parse(fs.readFileSync(path.join(dNum, 'manifest.json'), 'utf8'));
  mNum.tables[0].sha256 = createHash('sha256').update(badGz).digest('hex');
  fs.writeFileSync(path.join(dNum, 'manifest.json'), JSON.stringify(mNum));
  const errNum = runVerifierCliExpectFail(dNum);
  assert.match(errNum, /must be a JSON string/);
});

test('transformManifest normalises Arabic ي/ك to ی/ک and preserves newlines, NULLs, and decimal strings on sample-output/', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-duck-'));
  const { tables, conn } = await transformManifest({ dir: SAMPLE_DIR, outDir, memoryLimit: '256MB' });
  assert.equal(tables.length, 3);

  const kalaRows = await rows(conn, `SELECT * EXCLUDE (_row) FROM read_parquet('${tables[0].parquet}') ORDER BY _row`);
  assert.equal(kalaRows[0].name, 'برنج ایرانی');
  assert.equal(kalaRows[0].unit, 'کیلو');
  assert.equal(kalaRows[0].price, '1250000.00');
  assert.equal(kalaRows[1].code, null);

  const rawPartyLines = gunzipSync(fs.readFileSync(path.join(SAMPLE_DIR, 't2.ndjson.gz')))
    .toString('utf8')
    .trimEnd()
    .split('\n');
  assert.equal(rawPartyLines.length, 2);
  assert.equal(JSON.parse(rawPartyLines[0]).notes, 'خط اول\nخط دوم');

  const partyRows = await rows(conn, `SELECT * EXCLUDE (_row) FROM read_parquet('${tables[1].parquet}') ORDER BY _row`);
  assert.equal(partyRows.length, 2);
  assert.equal(partyRows[0].party_name, 'شرکت پارس یزد');
  assert.equal(partyRows[0].notes, 'خط اول خط دوم');
  assert.equal(partyRows[0].credit_limit, '50000000.0000');

  const sanadRows = await rows(conn, `SELECT * EXCLUDE (_row) FROM read_parquet('${tables[2].parquet}') ORDER BY _row`);
  assert.equal(sanadRows[0].description, 'فروش کالا به مشتری');
  assert.equal(sanadRows[1].description, null);
});

test('Extract-RoxiraTables.ps1 has no secret defaults, uses only SELECT, never echoes UploadCode, and implements bulk upload protocol', () => {
  const ps1 = fs.readFileSync(EXTRACTOR_PS1, 'utf8');
  assert.doesNotMatch(ps1, /\$UploadCode\s*=/i, 'UploadCode must not have a default value');
  assert.doesNotMatch(ps1, /\$SqlPassword\s*=/i, 'SqlPassword must not have a default value');
  assert.doesNotMatch(ps1, /Write-Host[^\n]*(\$UploadCode|\$SqlPassword|\$cs)/i, 'secrets/tokens must never be logged');
  assert.doesNotMatch(ps1, /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+TABLE|EXEC\s+)/i, 'only SELECT SQL is allowed');
  assert.match(ps1, /\/enterprise-hub\/data-import\/bulk\/uploads/);
  assert.match(ps1, /\/sign/);
  assert.match(ps1, /\/complete/);
});
