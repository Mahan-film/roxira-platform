import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { MigrationManifest, ManifestTable } from '../manifest';
import { BakRoute, chooseRoute, isLegacyVersionError, parseHeaderOnly } from './bak-header';
import { checkCapacity, CapacityPolicy, HostCapacity, SRV1_POLICY } from './capacity';
import {
  DEFAULT_IMAGE, DEFAULT_LIMITS, SandboxLimits, SandboxPaths, columnsSql, dockerRunArgs, exportSql, fileListSql, headerOnlySql,
  inventorySql, parseFileList, parseSqlcmdTable, restoreSql, sqlcmdShell,
} from './restore-plan';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** The only thing that touches the host: `docker <args>`. Always an argument array, never a shell string. */
export interface CommandRunner {
  docker(args: string[], options?: { timeoutMs?: number }): Promise<CommandResult>;
}

export interface BakJobInput {
  jobId: string;
  /** Local copy of the customer's .bak (downloaded from object storage by the worker). */
  bakFile: string;
  /** Empty scratch dir with room for the restored data (see capacity.ts). */
  scratchDir: string;
  /** Receives `<n>.ndjson.gz` files and `manifest.json`. */
  outDir: string;
}

export interface BakRunnerDeps {
  commands: CommandRunner;
  host: () => HostCapacity;
  sleep?: (ms: number) => Promise<void>;
  image?: string;
  edition?: string;
  limits?: SandboxLimits;
  policy?: CapacityPolicy;
  maxMajor?: number;
  log?: (line: string) => void;
}

export type BakOutcome =
  | { status: 'exported'; manifest: MigrationManifest }
  | { status: 'route'; route: Exclude<BakRoute, { route: 'restore' }> }
  | { status: 'refused'; code: 'disk' | 'memory' | 'edition-limit'; message: string };

const fail = (what: string, r: CommandResult): Error => new Error(`${what} failed (exit ${r.code}): ${(r.stderr || r.stdout).slice(0, 400)}`);

/**
 * Restores a SQL Server .bak in a throwaway, network-less container and exports every table as NDJSON.
 * Order: HEADERONLY first (route + version), FILELISTONLY (exact sizes -> capacity check), RESTORE, export.
 * The container is always removed, and so is the restored data.
 */
export class BakRestoreRunner {
  constructor(private readonly deps: BakRunnerDeps) {}

  private get image(): string { return this.deps.image ?? DEFAULT_IMAGE; }

  async run(input: BakJobInput): Promise<BakOutcome> {
    const { commands } = this.deps;
    const log = this.deps.log ?? (() => undefined);
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const limits = this.deps.limits ?? DEFAULT_LIMITS;
    const name = `rx-bak-${input.jobId.replace(/[^0-9a-f-]/gi, '').slice(0, 36).toLowerCase()}`;
    const dataDir = path.join(input.scratchDir, 'data');
    const workDir = path.join(input.scratchDir, 'work');
    for (const dir of [dataDir, workDir, input.outDir]) fs.mkdirSync(dir, { recursive: true, mode: 0o770 });
    // The SQL Server container runs as uid 10001 and must write the data dir and /out.
    for (const dir of [dataDir, workDir, input.outDir]) fs.chmodSync(dir, 0o777);
    const envFile = path.join(input.scratchDir, 'sa.env');
    // Random per job, 0600, never logged. Complexity rules of SQL Server: upper, lower, digit, symbol.
    const password = `Aa1!${randomBytes(18).toString('base64url')}`;
    fs.writeFileSync(envFile, `MSSQL_SA_PASSWORD=${password}\nACCEPT_EULA=Y\n`, { mode: 0o600 });
    const paths: SandboxPaths = { bakFile: input.bakFile, dataDir, workDir, outDir: input.outDir, envFile };
    const bakBytes = fs.statSync(input.bakFile).size;

    const sql = async (file: string, body: string, tabular: boolean, outFile: string | null = null, timeoutMs = limits.timeoutMs) => {
      fs.writeFileSync(path.join(workDir, file), body);
      return commands.docker(['exec', name, '/bin/sh', '-c', sqlcmdShell(`/work/${file}`, outFile, tabular)], { timeoutMs });
    };

    try {
      const started = await commands.docker(dockerRunArgs(name, paths, limits, this.image, this.deps.edition), { timeoutMs: 120_000 });
      if (started.code !== 0) throw fail('starting the sandbox', started);
      let ready = false;
      for (let i = 0; i < 60 && !ready; i += 1) {
        fs.writeFileSync(path.join(workDir, 'ping.sql'), 'SELECT 1;\n');
        ready = (await sql('ping.sql', 'SELECT 1;\n', true, null, 20_000)).code === 0;
        if (!ready) await sleep(2000);
      }
      if (!ready) throw new Error('SQL Server in the sandbox did not become ready within 2 minutes');

      const header = await sql('header.sql', headerOnlySql(), true);
      const headerText = `${header.stdout}\n${header.stderr}`;
      if (header.code !== 0) {
        if (isLegacyVersionError(headerText)) {
          return { status: 'route', route: { route: 'legacy-extractor', sqlGeneration: 'SQL Server 2000/2005', reason: 'The server rejected the backup with error 3169 (created by SQL Server 2000 or 2005). Use the Windows extractor.' } };
        }
        throw fail('RESTORE HEADERONLY', header);
      }
      const route = chooseRoute(parseHeaderOnly(parseSqlcmdTable(header.stdout)), { maxMajor: this.deps.maxMajor });
      if (route.route !== 'restore') return { status: 'route', route };
      log(`route=restore ${route.sqlGeneration} set=${route.set.position}`);

      const list = await sql('filelist.sql', fileListSql(route.set.position), true);
      if (list.code !== 0) throw fail('RESTORE FILELISTONLY', list);
      const files = parseFileList(parseSqlcmdTable(list.stdout));
      const capacity = checkCapacity(bakBytes, files, this.deps.host(), this.deps.policy ?? SRV1_POLICY);
      if (!capacity.ok) return { status: 'refused', code: capacity.code, message: capacity.message };

      const restored = await sql('restore.sql', restoreSql(route.set.position, files), false);
      if (restored.code !== 0) {
        if (isLegacyVersionError(`${restored.stdout}${restored.stderr}`)) {
          return { status: 'route', route: { route: 'legacy-extractor', sqlGeneration: route.sqlGeneration, reason: 'RESTORE failed with error 3169. Use the Windows extractor.' } };
        }
        throw fail('RESTORE DATABASE', restored);
      }

      const inv = await sql('inventory.sql', inventorySql(), true);
      const cols = await sql('columns.sql', columnsSql(), true);
      if (inv.code !== 0 || cols.code !== 0) throw fail('reading the table list', inv.code !== 0 ? inv : cols);
      const columnsByTable = new Map<string, { name: string; type: string }[]>();
      for (const c of parseSqlcmdTable(cols.stdout)) {
        const key = `${c.SchemaName}.${c.TableName}`;
        columnsByTable.set(key, [...(columnsByTable.get(key) ?? []), { name: String(c.ColumnName), type: String(c.DataType) }]);
      }

      const tables: ManifestTable[] = [];
      let n = 0;
      for (const t of parseSqlcmdTable(inv.stdout)) {
        const key = `${t.SchemaName}.${t.TableName}`;
        const columns = columnsByTable.get(key);
        const expected = Number(t.RowCnt ?? 0);
        if (!columns || columns.length === 0) continue;
        n += 1;
        const raw = `t${n}.ndjson`;
        const exported = await sql(`export_${n}.sql`, exportSql(String(t.SchemaName), String(t.TableName), columns), false, `/out/${raw}`);
        if (exported.code !== 0) throw fail(`exporting ${key}`, exported);
        const file = `${raw}.gz`;
        const sha256 = await gzipAndHash(path.join(input.outDir, raw), path.join(input.outDir, file));
        const rows = await countLinesGz(path.join(input.outDir, file));
        // sys.partitions row counts are approximate while a table is in use; the restored DB is read-only, so any gap is a real loss.
        if (rows !== expected) throw new Error(`${key}: exported ${rows} rows but the source has ${expected}`);
        tables.push({ schema: String(t.SchemaName), name: String(t.TableName), rows, file, sha256, columns });
      }
      const manifest: MigrationManifest = {
        version: 1,
        source: { kind: 'bak', sqlMajor: route.set.softwareVersionMajor, databaseName: route.set.databaseName, collation: route.set.collation, createdAt: new Date().toISOString() },
        tables,
      };
      fs.writeFileSync(path.join(input.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      return { status: 'exported', manifest };
    } finally {
      await commands.docker(['rm', '-f', name], { timeoutMs: 60_000 }).catch(() => undefined);
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(envFile, { force: true });
    }
  }
}

async function gzipAndHash(src: string, dest: string): Promise<string> {
  const hash = createHash('sha256');
  const tap = new (require('stream').Transform)({ transform(chunk: Buffer, _e: string, cb: (e: null, c: Buffer) => void) { hash.update(chunk); cb(null, chunk); } });
  await pipeline(fs.createReadStream(src), createGzip({ level: 6 }), tap, fs.createWriteStream(dest));
  fs.rmSync(src, { force: true });
  return hash.digest('hex');
}

async function countLinesGz(file: string): Promise<number> {
  let lines = 0;
  let last = 0x0a;
  await pipeline(fs.createReadStream(file), require('zlib').createGunzip(), new (require('stream').Writable)({
    write(chunk: Buffer, _e: string, cb: () => void) {
      for (let i = 0; i < chunk.length; i += 1) if (chunk[i] === 0x0a) lines += 1;
      last = chunk[chunk.length - 1];
      cb();
    },
  }));
  return last === 0x0a ? lines : lines + 1;
}
