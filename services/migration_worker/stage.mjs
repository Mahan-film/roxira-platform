/**
 * Typed staging: mapped Parquet -> typed Parquet (+ rejects) -> per-tenant PostgreSQL staging schema.
 * Rows that cannot be typed are never dropped silently: they go to `rejects/<target>.parquet` with the source table and
 * row number, and the certificate (phase 2.3) names them.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TARGETS } from './catalog.mjs';
import { qid, qstr, rows, openDuck } from './transform.mjs';
import { sqlAsciiDigits, sqlMoney, toIsoDate } from './normalize.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PG_TYPE = { text: 'text', money: 'numeric(28,4)', qty: 'numeric(28,6)', date: 'date', enum: 'text' };

/** `mig_<tenant uuid without dashes>`: one schema per tenant, built only from a validated UUID. */
export function schemaName(tenantId) {
  if (!UUID.test(tenantId)) throw new Error('tenant id must be a UUID');
  return `mig_${tenantId.replace(/-/g, '').toLowerCase()}`;
}

/** DDL for the staging schema: tenant_id on every table, FORCE row-level security (AGENTS.md hard rule). */
export function stagingDdl(tenantId) {
  const schema = schemaName(tenantId);
  const tenantMatch = `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`;
  const out = [`CREATE SCHEMA IF NOT EXISTS ${qid(schema)};`];
  for (const [target, def] of Object.entries(TARGETS)) {
    const cols = Object.entries(def.fields).flatMap(([f, d]) => (d.type === 'date' ? [`${qid(f)} date`, `${qid(`${f}_raw`)} text`] : [`${qid(f)} ${PG_TYPE[d.type]}`]));
    out.push(
      `CREATE TABLE IF NOT EXISTS ${qid(schema)}.${qid(target)} (\n  "tenant_id" uuid NOT NULL,\n  "src_table" text NOT NULL,\n  "src_row" bigint NOT NULL,\n  ${cols.join(',\n  ')}\n);`,
      `ALTER TABLE ${qid(schema)}.${qid(target)} ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE ${qid(schema)}.${qid(target)} FORCE ROW LEVEL SECURITY;`,
      `DROP POLICY IF EXISTS tenant_isolation ON ${qid(schema)}.${qid(target)};`,
      `CREATE POLICY tenant_isolation ON ${qid(schema)}.${qid(target)} USING (${tenantMatch}) WITH CHECK (${tenantMatch});`,
      `CREATE INDEX IF NOT EXISTS ${qid(`${target}_src`)} ON ${qid(schema)}.${qid(target)} ("src_table", "src_row");`,
    );
  }
  return out.join('\n');
}

/** Column list and typed SELECT for one mapped table. */
function typedSelect(target, fields, parquet, datesTable) {
  const defs = TARGETS[target].fields;
  const cols = [];
  const joins = [];
  let j = 0;
  for (const [f, d] of Object.entries(defs)) {
    const src = fields[f] ? `s.${qid(fields[f])}` : null;
    if (!src) {
      cols.push(...(d.type === 'date' ? [[f, 'NULL::DATE'], [`${f}_raw`, 'NULL::VARCHAR']] : [[f, 'NULL']]));
      continue;
    }
    if (d.type === 'money') cols.push([f, sqlMoney(src)]);
    else if (d.type === 'qty') cols.push([f, sqlMoney(src).replace('DECIMAL(28,4)', 'DECIMAL(28,6)')]);
    else if (d.type === 'date') {
      j += 1;
      joins.push(`LEFT JOIN ${datesTable} d${j} ON d${j}.raw = ${sqlAsciiDigits(src)}`);
      cols.push([f, `try_cast(d${j}.iso AS DATE)`], [`${f}_raw`, src]);
    } else cols.push([f, d.type === 'enum' ? `lower(${src})` : src]);
  }
  return { cols, from: `read_parquet(${qstr(parquet)}) s ${joins.join(' ')}` };
}

/** Distinct date strings -> ISO in JS (Jalali aware), joined back in SQL so a 50 GB table is never read into JS. */
async function loadDates(conn, parquet, columns, table) {
  await conn.run(`CREATE OR REPLACE TEMP TABLE ${table} (raw VARCHAR, iso VARCHAR)`);
  const seen = new Set();
  for (const col of columns) {
    for (const r of await rows(conn, `SELECT DISTINCT ${sqlAsciiDigits(qid(col))} AS v FROM read_parquet(${qstr(parquet)}) WHERE ${qid(col)} IS NOT NULL`)) {
      if (seen.has(r.v)) continue;
      seen.add(r.v);
    }
  }
  const values = [...seen];
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500).map((v) => [v, toIsoDate(v)]).filter(([, iso]) => iso);
    if (chunk.length) await conn.run(`INSERT INTO ${table} VALUES ${chunk.map(([v, iso]) => `(${qstr(v)}, ${qstr(iso)})`).join(',')}`);
  }
}

/**
 * Stages every mapped table. `mappings`: [{ table, status:'mapped', target, fields }], `tables`: from transformManifest.
 * Returns a report with row counts per target and the reject counts.
 */
export async function stageAll({ conn, tables, mappings, outDir }) {
  const stagedDir = path.join(outDir, 'staged');
  const rejectDir = path.join(outDir, 'rejects');
  fs.mkdirSync(stagedDir, { recursive: true });
  fs.mkdirSync(rejectDir, { recursive: true });
  const report = { staged: {}, rejected: {}, skipped: [] };
  let n = 0;
  for (const m of mappings) {
    const t = tables.find((x) => x.name === m.table);
    if (!t || m.status !== 'mapped') { report.skipped.push({ table: m.table, reason: m.reason ?? m.status }); continue; }
    n += 1;
    const defs = TARGETS[m.target].fields;
    const dateCols = Object.entries(defs).filter(([f, d]) => d.type === 'date' && m.fields[f]).map(([f]) => m.fields[f]);
    const datesTable = `rx_dates_${n}`;
    await loadDates(conn, t.parquet, dateCols, datesTable);
    const { cols, from } = typedSelect(m.target, m.fields, t.parquet, datesTable);
    const selectList = cols.map(([name, expr]) => `${expr} AS ${qid(name)}`).join(', ');
    // A row is rejected when a required field is empty, or an amount/quantity had text that did not parse (never guess a
    // number). An optional date that does not parse stays NULL with the raw text kept: dropping the row would lose its amount.
    const bad = Object.entries(defs).flatMap(([f, d]) => {
      if (!m.fields[f]) return d.required ? ['TRUE'] : [];
      const raw = `s.${qid(m.fields[f])}`;
      const typed = cols.find(([name]) => name === f)[1];
      const unparsable = d.type === 'money' || d.type === 'qty' ? `(${raw} IS NOT NULL AND (${typed}) IS NULL)` : null;
      return [...(d.required ? [`(${typed}) IS NULL`] : []), ...(unparsable ? [unparsable] : [])];
    });
    const rejectWhere = bad.length ? bad.join(' OR ') : 'FALSE';
    const typedFile = path.join(stagedDir, `${m.target}__${n}.parquet`);
    const rejectFile = path.join(rejectDir, `${m.target}__${n}.parquet`);
    await conn.run(`COPY (SELECT ${qstr(t.name)} AS src_table, s._row AS src_row, ${selectList} FROM ${from} WHERE NOT (${rejectWhere})) TO ${qstr(typedFile)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
    await conn.run(`COPY (SELECT ${qstr(t.name)} AS src_table, s._row AS src_row FROM ${from} WHERE (${rejectWhere})) TO ${qstr(rejectFile)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
    const [{ a }] = await rows(conn, `SELECT count(*) AS a FROM read_parquet(${qstr(typedFile)})`);
    const [{ r }] = await rows(conn, `SELECT count(*) AS r FROM read_parquet(${qstr(rejectFile)})`);
    if (Number(a) + Number(r) !== t.rows) throw new Error(`${t.name}: staged ${a} + rejected ${r} != source ${t.rows}`);
    report.staged[m.target] = (report.staged[m.target] ?? 0) + Number(a);
    report.rejected[m.target] = (report.rejected[m.target] ?? 0) + Number(r);
  }
  fs.writeFileSync(path.join(outDir, 'stage-report.json'), JSON.stringify(report, null, 2));
  return { report, stagedDir, rejectDir };
}

/**
 * Loads staged Parquet into `mig_<tenant>` with DuckDB's PostgreSQL extension, which writes with binary COPY.
 * `dsn` comes from the environment (never logged). The extension must be installed ahead of time on the worker
 * (`INSTALL postgres`), because the worker box has no reason to reach the extension repository at run time.
 * Returns the statements it ran (or would run, with `dryRun`).
 */
export async function loadToPostgres({ conn, tenantId, stagedDir, dsn, dryRun = false }) {
  if (!UUID.test(tenantId)) throw new Error('tenant id must be a UUID');
  const schema = schemaName(tenantId);
  const files = fs.readdirSync(stagedDir).filter((f) => f.endsWith('.parquet')).sort();
  const statements = [`ATTACH '<dsn from MIGRATION_PG_DSN>' AS pg (TYPE postgres);`];
  for (const f of files) {
    const target = f.split('__')[0];
    if (!TARGETS[target]) continue;
    const colsOf = ['src_table', 'src_row', ...Object.entries(TARGETS[target].fields).flatMap(([k, d]) => (d.type === 'date' ? [k, `${k}_raw`] : [k]))];
    statements.push(
      `INSERT INTO pg.${qid(schema)}.${qid(target)} (tenant_id, ${colsOf.map(qid).join(', ')}) SELECT ${qstr(tenantId)}::UUID, ${colsOf.map(qid).join(', ')} FROM read_parquet(${qstr(path.join(stagedDir, f))});`,
    );
  }
  if (dryRun) return { statements };
  if (!dsn) throw new Error('MIGRATION_PG_DSN is not set');
  await conn.run('LOAD postgres');
  await conn.run(`ATTACH ${qstr(dsn)} AS pg (TYPE postgres)`);
  for (const s of statements.slice(1)) await conn.run(s);
  return { statements };
}

export { openDuck };
