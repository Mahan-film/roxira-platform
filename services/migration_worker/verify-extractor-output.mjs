#!/usr/bin/env node
/**
 * node verify-extractor-output.mjs <dir>
 *
 * Local, trust-nothing check of an extractor export before it is uploaded to the server: the server does the same
 * checks on untrusted input. Fails with the first reason found, exits 1 (usage errors exit 2).
 *
 *   1. `manifest.json` passes `parseManifest` (safe file names, row counts, hashes, no duplicates).
 *   2. Every file it names exists and its SHA-256 matches the manifest.
 *   3. Every line of the NDJSON(.gz) is a JSON object and the line count equals the manifest `rows`.
 *   4. `decimal`, `numeric`, `money`, `smallmoney`, `float`, `real` and `bigint` columns are JSON strings, never
 *      numbers, so no amount can pass through a double.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { parseManifest, sha256File } from './manifest.mjs';

export class VerifyError extends Error {}

const AMOUNT_AS_TEXT = new Set(['decimal', 'numeric', 'money', 'smallmoney', 'float', 'real', 'bigint']);

/** Streams the file, counts non-empty lines and refuses a JSON number in an amount column. */
export async function inspectNdjson(file, columns, label) {
  const numeric = columns.filter((c) => AMOUNT_AS_TEXT.has(String(c.type).toLowerCase())).map((c) => c.name);
  const source = fs.createReadStream(file);
  const stream = file.endsWith('.gz') ? source.pipe(createGunzip()) : source;
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let rows = 0;
  try {
    for await (const line of lines) {
      if (line.length === 0) continue;
      rows += 1;
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        throw new VerifyError(`${label}: line ${rows} is not valid JSON`);
      }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new VerifyError(`${label}: line ${rows} is not a JSON object`);
      for (const name of numeric) {
        if (typeof value[name] === 'number') throw new VerifyError(`${label}: column ${name} is a JSON number; decimal/money columns must be JSON strings`);
      }
    }
  } finally {
    lines.close();
  }
  return rows;
}

/** Runs every check in order and returns the manifest; throws `VerifyError` (or `ManifestError`) on the first failure. */
export async function verifyExtractorOutput(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new VerifyError(`manifest.json is missing in ${dir}`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new VerifyError('manifest.json is not valid JSON');
  }
  const manifest = parseManifest(raw);
  const counts = [];
  for (const t of manifest.tables) {
    const label = `${t.schema}.${t.name}`;
    const file = path.join(dir, t.file);
    if (!fs.existsSync(file)) throw new VerifyError(`${label}: file ${t.file} is missing`);
    if ((await sha256File(file)) !== t.sha256) throw new VerifyError(`${label}: sha256 mismatch (${t.file} is modified or damaged)`);
    const rows = await inspectNdjson(file, t.columns, label);
    if (rows !== t.rows) throw new VerifyError(`${label}: manifest says ${t.rows} rows, ${t.file} has ${rows}`);
    counts.push({ table: label, rows });
  }
  return { manifest, counts };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node verify-extractor-output.mjs <dir>');
    process.exit(2);
  }
  try {
    const { manifest, counts } = await verifyExtractorOutput(dir);
    const total = counts.reduce((sum, c) => sum + c.rows, 0);
    console.log(`OK: ${manifest.tables.length} tables, ${total} rows verified in ${dir}`);
  } catch (error) {
    console.error(`verify-extractor-output: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
