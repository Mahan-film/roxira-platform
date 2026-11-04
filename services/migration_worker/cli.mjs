#!/usr/bin/env node
/**
 * node cli.mjs --manifest-dir <dir> --out <dir> [--tenant <uuid>] [--ai] [--print-ddl] [--load]
 * Steps: verify + normalise to Parquet, discover the schema (heuristic, then AI for the rest when --ai), type + stage.
 * Loading (--load) needs MIGRATION_PG_DSN in the environment. Nothing is printed from the environment.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { discoverSchema, litellmClient } from './discover.mjs';
import { loadToPostgres, stageAll, stagingDdl } from './stage.mjs';
import { sampleRows, transformManifest } from './transform.mjs';

const args = process.argv.slice(2);
const opt = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const flag = (n) => args.includes(`--${n}`);

if (flag('print-ddl')) {
  console.log(stagingDdl(opt('tenant') ?? ''));
  process.exit(0);
}
const dir = opt('manifest-dir');
const out = opt('out');
if (!dir || !out) { console.error('usage: --manifest-dir <dir> --out <dir> [--tenant <uuid>] [--ai] [--load]'); process.exit(2); }

const { tables, conn } = await transformManifest({ dir, outDir: out, memoryLimit: opt('memory') ?? '1GB' });
const mappings = await discoverSchema(tables, (t) => sampleRows(conn, tables.find((x) => x.name === t.name).parquet, 5), flag('ai') ? litellmClient() : undefined);
fs.writeFileSync(path.join(out, 'mapping.json'), JSON.stringify(mappings, null, 2));
const { report, stagedDir } = await stageAll({ conn, tables, mappings, outDir: out });
console.log(JSON.stringify({ mapped: mappings.filter((m) => m.status === 'mapped').length, needsReview: mappings.filter((m) => m.status !== 'mapped').map((m) => m.table), ...report }));
if (flag('load')) {
  await loadToPostgres({ conn, tenantId: opt('tenant'), stagedDir, dsn: process.env.MIGRATION_PG_DSN });
  console.log('loaded');
}
