import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { chooseRoute, isLegacyVersionError, parseHeaderOnly } from './bak-header';
import { checkCapacity, SRV1_POLICY } from './capacity';
import { BakRestoreRunner, CommandResult, CommandRunner } from './restore-runner';
import {
  FIELD_SEPARATOR, dockerRunArgs, exportSql, parseSqlcmdTable, restoreSql, sqlIdent, sqlString, DEFAULT_LIMITS,
} from './restore-plan';
import { ManifestError, parseManifest } from '../manifest';

const GiB = 1024 ** 3;
const S = FIELD_SEPARATOR;
const table = (cols: string[], rows: string[][]) =>
  [cols.join(S), cols.map((c) => '-'.repeat(c.length)).join(S), ...rows.map((r) => r.join(S))].join('\n') + '\n';

describe('RESTORE HEADERONLY routing', () => {
  const header = (over: Record<string, unknown>) => parseHeaderOnly([{ Position: 1, BackupType: 1, DatabaseName: 'Holoo1', SoftwareVersionMajor: 10, DatabaseVersion: 661, Collation: 'Persian_100_CI_AS', Compressed: 0, BackupSize: 1000, ...over }]);

  it('restores 2008 R2 and later, picking the newest full backup in a multi-set file', () => {
    const sets = parseHeaderOnly([
      { Position: 1, BackupType: 1, SoftwareVersionMajor: 12, DatabaseName: 'a' },
      { Position: 2, BackupType: 5, SoftwareVersionMajor: 12, DatabaseName: 'a' },
      { Position: 3, BackupType: 1, SoftwareVersionMajor: 12, DatabaseName: 'a' },
    ]);
    const route = chooseRoute(sets);
    expect(route.route).toBe('restore');
    expect(route.route === 'restore' && route.set.position).toBe(3);
  });

  it('sends SQL Server 2000 and 2005 backups to the Windows extractor', () => {
    for (const major of [8, 9]) expect(chooseRoute(header({ SoftwareVersionMajor: major })).route).toBe('legacy-extractor');
    expect(isLegacyVersionError('Msg 3169, Level 16: The database was backed up on a server running version 8.00.2039')).toBe(true);
    expect(isLegacyVersionError('Msg 3241 something else')).toBe(false);
  });

  it('refuses encrypted, differential-only, log-only, newer-than-image and empty files with a reason', () => {
    expect(chooseRoute(header({ KeyAlgorithm: 'aes_256' }))).toMatchObject({ route: 'unsupported', reason: expect.stringMatching(/encrypted/) });
    expect(chooseRoute(header({ BackupType: 5 }))).toMatchObject({ route: 'unsupported', reason: expect.stringMatching(/differential/) });
    expect(chooseRoute(header({ BackupType: 2 }))).toMatchObject({ route: 'unsupported', reason: expect.stringMatching(/transaction log/) });
    expect(chooseRoute(header({ SoftwareVersionMajor: 16 }))).toMatchObject({ route: 'unsupported', reason: expect.stringMatching(/newer/) });
    expect(chooseRoute([]).route).toBe('unsupported');
  });
});

describe('sandbox plan', () => {
  const paths = { bakFile: '/data/in.bak', dataDir: '/s/data', workDir: '/s/work', outDir: '/s/out', envFile: '/s/sa.env' };

  it('has no network, capped resources, dropped capabilities, read-only backup and no secret in argv', () => {
    const args = dockerRunArgs('rx-bak-0123abcd-ef', paths, DEFAULT_LIMITS);
    expect(args.slice(args.indexOf('--network'), args.indexOf('--network') + 2)).toEqual(['--network', 'none']);
    expect(args).toEqual(expect.arrayContaining(['--memory', '4096m', '--pids-limit', '1024', '--cap-drop', 'ALL', 'no-new-privileges']));
    expect(args).toContain('/data/in.bak:/backup/in.bak:ro');
    expect(args.join(' ')).not.toMatch(/MSSQL_SA_PASSWORD=/);
    expect(args).toContain('MSSQL_PID=Express');
    expect(() => dockerRunArgs('x; rm -rf /', paths, DEFAULT_LIMITS)).toThrow();
    expect(() => dockerRunArgs('rx-bak-0123abcd-ef', paths, DEFAULT_LIMITS, 'img --privileged')).toThrow();
  });

  it('quotes hostile logical names, table and column names', () => {
    expect(sqlString("a'; DROP DATABASE x;--")).toBe("N'a''; DROP DATABASE x;--'");
    expect(sqlIdent('t]; DROP TABLE x;--')).toBe('[t]]; DROP TABLE x;--]');
    const sqlText = restoreSql(1, [{ logicalName: "Holoo'); EXEC xp_cmdshell 'x';--", type: 'D', sizeBytes: 1 }, { logicalName: 'Holoo_log', type: 'L', sizeBytes: 1 }]);
    expect(sqlText).toContain("MOVE N'Holoo''); EXEC xp_cmdshell ''x'';--' TO N'/var/opt/mssql/data/rx_0.mdf'");
    expect(sqlText).toContain('READ_ONLY');
    expect(() => restoreSql(1, [{ logicalName: 'fs', type: 'S', sizeBytes: 1 }])).toThrow(/FILESTREAM/);
  });

  it('exports amounts as strings and one JSON object per row', () => {
    const s = exportSql('dbo', 'Voucher', [{ name: 'Amount', type: 'decimal' }, { name: 'Title', type: 'nvarchar' }, { name: 'Raw', type: 'xml' }]);
    expect(s).toContain('CAST(x.[Amount] AS nvarchar(64)) AS [Amount]');
    expect(s).toContain('x.[Title] AS [Title]');
    expect(s).toContain('CAST(x.[Raw] AS nvarchar(max))');
    expect(s).toContain('FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES) FROM [dbo].[Voucher] AS x');
  });

  it('parses sqlcmd tables including NULLs and the rows-affected trailer', () => {
    const rows = parseSqlcmdTable(table(['A', 'B'], [['1', 'x'], ['2', 'NULL']]) + '(2 rows affected)\n');
    expect(rows).toEqual([{ A: '1', B: 'x' }, { A: '2', B: null }]);
  });
});

describe('capacity (srv1 has ~16 GB free)', () => {
  const files = (data: number) => [{ logicalName: 'd', type: 'D', sizeBytes: data }, { logicalName: 'l', type: 'L', sizeBytes: GiB }];
  it('accepts a small backup and refuses a big one with a "separate worker box" message', () => {
    expect(checkCapacity(GiB, files(2 * GiB), { freeDiskBytes: 16 * GiB, freeMemBytes: 8 * GiB }).ok).toBe(true);
    const big = checkCapacity(4 * GiB, files(9 * GiB), { freeDiskBytes: 16 * GiB, freeMemBytes: 8 * GiB });
    expect(big).toMatchObject({ ok: false, code: 'disk', message: expect.stringMatching(/separate migration worker box/) });
  });
  it('refuses low memory and databases over the Express 10 GB limit', () => {
    expect(checkCapacity(GiB, files(GiB), { freeDiskBytes: 100 * GiB, freeMemBytes: GiB })).toMatchObject({ ok: false, code: 'memory' });
    expect(checkCapacity(GiB, files(12 * GiB), { freeDiskBytes: 500 * GiB, freeMemBytes: 8 * GiB }, SRV1_POLICY)).toMatchObject({ ok: false, code: 'edition-limit' });
    expect(checkCapacity(GiB, files(12 * GiB), { freeDiskBytes: 500 * GiB, freeMemBytes: 8 * GiB }, { ...SRV1_POLICY, editionDataLimitBytes: null }).ok).toBe(true);
  });
});

describe('BakRestoreRunner with a fake docker', () => {
  let dir: string;
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bak-'))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });
  function fakeDocker(opts: { major?: number; headerError?: string; rows?: number; exportRows?: number }): { runner: CommandRunner; calls: string[][] } {
    const calls: string[][] = [];
    const workDir = path.join(dir, 'scratch', 'work');
    const outDir = path.join(dir, 'out');
    const rows = opts.rows ?? 3;
    const runner: CommandRunner = {
      async docker(args) {
        calls.push(args);
        if (args[0] !== 'exec') return ok();
        const cmd = args[args.length - 1];
        const script = /-i \/work\/(\S+)/.exec(cmd)?.[1] ?? '';
        const body = fs.existsSync(path.join(workDir, script)) ? fs.readFileSync(path.join(workDir, script), 'utf8') : '';
        if (script === 'ping.sql') return ok();
        if (script === 'header.sql') {
          if (opts.headerError) return { code: 1, stdout: opts.headerError, stderr: '' };
          return ok(table(['Position', 'BackupType', 'DatabaseName', 'SoftwareVersionMajor', 'DatabaseVersion', 'Collation', 'Compressed', 'BackupSize'], [['1', '1', 'Holoo1', String(opts.major ?? 10), '661', 'Persian_100_CI_AS', '0', '1000']]));
        }
        if (script === 'filelist.sql') return ok(table(['LogicalName', 'Type', 'Size'], [['Holoo1', 'D', String(50 * 1024 * 1024)], ['Holoo1_log', 'L', '1048576']]));
        if (script === 'restore.sql') return body.includes('MOVE') ? ok() : { code: 1, stdout: '', stderr: 'no MOVE' };
        if (script === 'inventory.sql') return ok(table(['SchemaName', 'TableName', 'RowCnt'], [['dbo', 'Party', String(rows)]]));
        if (script === 'columns.sql') return ok(table(['SchemaName', 'TableName', 'ColumnName', 'DataType'], [['dbo', 'Party', 'Name', 'nvarchar'], ['dbo', 'Party', 'Balance', 'decimal']]));
        if (script.startsWith('export_')) {
          const outFile = /-o \/out\/(\S+)/.exec(cmd)?.[1] as string;
          const lines = Array.from({ length: opts.exportRows ?? rows }, (_, i) => JSON.stringify({ Name: `علی ${i}`, Balance: String(i * 1000) })).join('\n') + '\n';
          fs.writeFileSync(path.join(outDir, outFile), lines);
          return ok();
        }
        return { code: 1, stdout: '', stderr: `unexpected ${script}` };
      },
    };
    return { runner, calls };
  }
  const make = (runner: CommandRunner, free = 100 * GiB) => {
    const bak = path.join(dir, 'in.bak');
    fs.writeFileSync(bak, 'x'.repeat(1000));
    const r = new BakRestoreRunner({ commands: runner, host: () => ({ freeDiskBytes: free, freeMemBytes: 8 * GiB }), sleep: async () => undefined });
    return { r, input: { jobId: '0123abcd-4567-89ab-cdef-0123456789ab', bakFile: bak, scratchDir: path.join(dir, 'scratch'), outDir: path.join(dir, 'out') } };
  };

  it('restores, exports every table as gzip NDJSON, verifies row counts and writes a valid manifest', async () => {
    const { runner, calls } = fakeDocker({});
    const { r, input } = make(runner);
    const out = await r.run(input);
    expect(out.status).toBe('exported');
    const manifest = parseManifest(JSON.parse(fs.readFileSync(path.join(input.outDir, 'manifest.json'), 'utf8')));
    expect(manifest.tables[0]).toMatchObject({ schema: 'dbo', name: 'Party', rows: 3 });
    const gz = fs.readFileSync(path.join(input.outDir, manifest.tables[0].file));
    expect(createHash('sha256').update(gz).digest('hex')).toBe(manifest.tables[0].sha256);
    expect(gunzipSync(gz).toString().trim().split('\n')).toHaveLength(3);
    expect(calls.at(-1)).toEqual(['rm', '-f', 'rx-bak-0123abcd-4567-89ab-cdef-0123456789ab']); // sandbox always removed
    expect(fs.existsSync(path.join(input.scratchDir, 'data'))).toBe(false);
    expect(fs.existsSync(path.join(input.scratchDir, 'sa.env'))).toBe(false);
  });

  it('fails loudly and cleans up when an exported table lost rows', async () => {
    const { runner, calls } = fakeDocker({ rows: 5, exportRows: 4 });
    const { r, input } = make(runner);
    await expect(r.run(input)).rejects.toThrow(/exported 4 rows but the source has 5/);
    expect(calls.at(-1)?.[0]).toBe('rm');
  });

  it('routes a 2005 backup (error 3169) to the extractor without restoring anything', async () => {
    const { runner, calls } = fakeDocker({ headerError: 'Msg 3169, Level 16, State 1: The database was backed up on a server running version 9.00.5000' });
    const { r, input } = make(runner);
    const out = await r.run(input);
    expect(out).toMatchObject({ status: 'route', route: { route: 'legacy-extractor' } });
    expect(calls.some((c) => c.join(' ').includes('restore.sql'))).toBe(false);
  });

  it('refuses before RESTORE when the disk cannot hold the database (no partial restore on srv1)', async () => {
    const { runner, calls } = fakeDocker({});
    const { r, input } = make(runner, 8.05 * GiB);
    const out = await r.run(input);
    expect(out).toMatchObject({ status: 'refused', code: 'disk' });
    expect(calls.some((c) => c.join(' ').includes('restore.sql'))).toBe(false);
  });
});

describe('manifest validation (untrusted extractor output)', () => {
  const t = { schema: 'dbo', name: 'A', rows: 1, file: 'a.ndjson.gz', sha256: 'a'.repeat(64), columns: [{ name: 'x', type: 'int' }] };
  const m = (over: object = {}) => ({ version: 1, source: { kind: 'extractor', sqlMajor: 9, databaseName: 'd', collation: null, createdAt: 'x' }, tables: [t], ...over });
  it('accepts a good manifest and rejects path tricks, duplicates and bad hashes', () => {
    expect(parseManifest(m()).tables).toHaveLength(1);
    expect(() => parseManifest(m({ tables: [{ ...t, file: '../../etc/passwd' }] }))).toThrow(ManifestError);
    expect(() => parseManifest(m({ tables: [{ ...t, file: 'a/b.ndjson' }] }))).toThrow(ManifestError);
    expect(() => parseManifest(m({ tables: [t, { ...t, file: 'b.ndjson.gz' }] }))).toThrow(/duplicate/);
    expect(() => parseManifest(m({ tables: [{ ...t, sha256: 'zz' }] }))).toThrow(ManifestError);
    expect(() => parseManifest({ version: 2 })).toThrow(ManifestError);
  });
});
