/**
 * Manifest (NDJSON per table) -> normalised Parquet, out of core. DuckDB streams each file, so memory is bounded by
 * `memoryLimit` whatever the size (spills to `tempDir`). Every column is read as text first: typing happens in
 * stage.mjs after the schema is known, so no value is ever rounded or mis-parsed on the way in.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseManifest, sha256File } from './manifest.mjs';
import { sqlNormText } from './normalize.mjs';

export const qid = (name) => `"${String(name).replace(/"/g, '""')}"`;
export const qstr = (s) => `'${String(s).replace(/'/g, "''")}'`;

export async function openDuck({ memoryLimit = '1GB', tempDir, threads = 2 } = {}) {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  await conn.run(`SET memory_limit=${qstr(memoryLimit)}`);
  await conn.run(`SET threads=${Number(threads) || 2}`);
  if (tempDir) { fs.mkdirSync(tempDir, { recursive: true }); await conn.run(`SET temp_directory=${qstr(tempDir)}`); }
  return { instance, conn, close: () => conn.closeSync?.() };
}

export const rows = async (conn, sql) => (await conn.runAndReadAll(sql)).getRowObjectsJson();

/** Verifies hashes and row counts against the manifest, then writes `outDir/parquet/tN.parquet`. */
export async function transformManifest({ dir, outDir, memoryLimit, tempDir, threads }) {
  const manifest = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
  const parquetDir = path.join(outDir, 'parquet');
  fs.mkdirSync(parquetDir, { recursive: true });
  const { conn } = await openDuck({ memoryLimit, tempDir: tempDir ?? path.join(outDir, 'spill'), threads });
  const out = [];
  let n = 0;
  for (const t of manifest.tables) {
    n += 1;
    const src = path.join(dir, t.file);
    if (!fs.existsSync(src)) throw new Error(`${t.name}: file ${t.file} is missing`);
    if ((await sha256File(src)) !== t.sha256) throw new Error(`${t.name}: sha256 mismatch (file damaged or tampered with)`);
    const names = t.columns.map((c) => c.name);
    const dict = names.map((c) => `${qstr(c)}: 'VARCHAR'`).join(', ');
    const select = names.map((c) => `${sqlNormText(qid(c))} AS ${qid(c)}`).join(', ');
    const parquet = path.join(parquetDir, `t${n}.parquet`);
    await conn.run(
      `COPY (SELECT row_number() OVER () AS _row, ${select} FROM read_json(${qstr(src)}, format='newline_delimited', columns={${dict}}, ignore_errors=false)) TO ${qstr(parquet)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    const [{ c }] = await rows(conn, `SELECT count(*) AS c FROM read_parquet(${qstr(parquet)})`);
    if (Number(c) !== t.rows) throw new Error(`${t.name}: manifest says ${t.rows} rows, read ${c}`);
    out.push({ schema: t.schema, name: t.name, rows: t.rows, columns: names, parquet });
  }
  return { manifest, tables: out, conn };
}

export async function sampleRows(conn, parquet, limit = 5) {
  return rows(conn, `SELECT * EXCLUDE (_row) FROM read_parquet(${qstr(parquet)}) LIMIT ${Math.min(50, Math.max(1, limit))}`);
}
