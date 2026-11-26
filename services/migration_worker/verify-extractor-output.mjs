import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { ManifestError, parseManifest, sha256File } from './manifest.mjs';

export const STRING_NUMERIC_TYPES = new Set([
  'decimal',
  'numeric',
  'money',
  'smallmoney',
  'float',
  'real',
  'bigint',
]);

export class ExtractorOutputError extends Error {}

function resolveInside(dir, file) {
  const root = path.resolve(dir);
  const full = path.resolve(root, file);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new ExtractorOutputError(`unsafe file path outside export dir: ${file}`);
  }
  return full;
}

async function verifyTableFile(dir, table) {
  const filePath = resolveInside(dir, table.file);
  if (!fs.existsSync(filePath)) {
    throw new ExtractorOutputError(`${table.name}: file ${table.file} is missing`);
  }

  const actualSha = await sha256File(filePath);
  if (actualSha !== table.sha256) {
    throw new ExtractorOutputError(
      `${table.name}: sha256 mismatch for ${table.file} (expected ${table.sha256}, got ${actualSha})`,
    );
  }

  const numericStringCols = new Set(
    table.columns
      .filter((col) => STRING_NUMERIC_TYPES.has(String(col.type ?? '').toLowerCase()))
      .map((col) => col.name),
  );

  const rawStream = fs.createReadStream(filePath);
  const lineSource = table.file.endsWith('.gz') ? rawStream.pipe(createGunzip()) : rawStream;
  const rl = readline.createInterface({ input: lineSource, crlfDelay: Infinity });

  let rowCount = 0;
  try {
    for await (const line of rl) {
      if (line.trim() === '') continue;
      rowCount += 1;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new ExtractorOutputError(
          `${table.name} row ${rowCount}: invalid JSON (${err.message})`,
        );
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ExtractorOutputError(
          `${table.name} row ${rowCount}: expected JSON object`,
        );
      }
      for (const colName of numericStringCols) {
        const val = parsed[colName];
        if (val !== null && val !== undefined && typeof val !== 'string') {
          throw new ExtractorOutputError(
            `${table.name} row ${rowCount}: numeric/decimal column '${colName}' must be a JSON string, got ${typeof val}`,
          );
        }
      }
    }
  } finally {
    rl.close();
    rawStream.destroy();
  }

  if (rowCount !== table.rows) {
    throw new ExtractorOutputError(
      `${table.name}: row count mismatch (manifest says ${table.rows}, read ${rowCount})`,
    );
  }

  return { schema: table.schema, name: table.name, file: table.file, rows: rowCount };
}

export async function verifyExtractorOutput(dir) {
  if (!dir) {
    throw new ExtractorOutputError('usage: node verify-extractor-output.mjs <dir>');
  }
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new ExtractorOutputError(`manifest.json not found in ${dir}`);
  }

  let rawManifest;
  try {
    rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new ExtractorOutputError(`manifest.json is not valid JSON: ${err.message}`);
  }

  const manifest = parseManifest(rawManifest);
  const tables = [];
  for (const table of manifest.tables) {
    tables.push(await verifyTableFile(dir, table));
  }
  return { ok: true, tables };
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCli) {
  const dir = process.argv[2];
  verifyExtractorOutput(dir)
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    })
    .catch((err) => {
      const prefix = err instanceof ManifestError || err instanceof ExtractorOutputError ? 'VERIFY FAIL' : 'VERIFY ERROR';
      process.stderr.write(`${prefix}: ${err.message}\n`);
      process.exit(1);
    });
}
