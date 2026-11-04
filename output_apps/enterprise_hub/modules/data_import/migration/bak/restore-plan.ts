/**
 * Builders for everything the restore sandbox runs: the `docker run` argument vector and the T-SQL scripts.
 * No shell is ever involved (argument arrays only) and every identifier that came from the customer's file
 * (logical file names, schema, table and column names) is quoted by the helpers below.
 */
import { HeaderRow } from './bak-header';

export const IN_CONTAINER_BAK = '/backup/in.bak';
export const SQLCMD = '/opt/mssql-tools/bin/sqlcmd';
export const DEFAULT_IMAGE = 'mcr.microsoft.com/mssql/server:2019-latest';
export const RESTORED_DB = 'rx_import';
export const FIELD_SEPARATOR = '\u001f';

export interface SandboxLimits {
  memoryMiB: number;
  cpus: number;
  pids: number;
  /** Wall clock for the whole job; the runner kills the container after this. */
  timeoutMs: number;
}

export const DEFAULT_LIMITS: SandboxLimits = { memoryMiB: 4096, cpus: 2, pids: 1024, timeoutMs: 6 * 60 * 60 * 1000 };

/** T-SQL string literal for an NVARCHAR constant: N'...' with quotes doubled. */
export function sqlString(value: string): string {
  if (value.includes('\0')) throw new Error('NUL in a SQL string');
  return `N'${value.replace(/'/g, "''")}'`;
}

/** Bracket-quoted identifier: `]` doubled. */
export function sqlIdent(name: string): string {
  if (name.includes('\0') || name.length === 0 || name.length > 128) throw new Error('Invalid SQL identifier');
  return `[${name.replace(/]/g, ']]')}]`;
}

export interface SandboxPaths {
  /** Host file (read-only inside the sandbox). */
  bakFile: string;
  /** Host dir that receives the restored data files (needs about the restored size, see capacity.ts). */
  dataDir: string;
  /** Host dir with the generated .sql scripts (mounted at /work). */
  workDir: string;
  /** Host dir that receives the NDJSON exports (mounted at /out). */
  outDir: string;
  /** Host file with `MSSQL_SA_PASSWORD=...` and `ACCEPT_EULA=Y` (mode 0600). */
  envFile: string;
}

/**
 * `--network none`: the restored database is unreachable from anywhere and cannot call out (linked servers,
 * xp_cmdshell payloads in a hostile backup have no network). The only channel is `docker exec`.
 * `MSSQL_PID` defaults to Express (free for production, 10 GB per database); Developer is not licensed for
 * production use, so it is opt-in by the owner (docs/ops/BAK_PIPELINE.md).
 */
export function dockerRunArgs(name: string, paths: SandboxPaths, limits: SandboxLimits, image = DEFAULT_IMAGE, edition = 'Express'): string[] {
  if (!/^rx-bak-[0-9a-f-]{8,40}$/.test(name)) throw new Error('Unsafe container name');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,200}$/.test(image)) throw new Error('Unsafe image reference');
  if (!/^(Express|Developer|Standard|Enterprise|Web)$/.test(edition)) throw new Error('Unknown edition');
  return [
    'run', '-d', '--name', name,
    '--network', 'none',
    '--memory', `${limits.memoryMiB}m`, '--memory-swap', `${limits.memoryMiB}m`,
    '--cpus', String(limits.cpus),
    '--pids-limit', String(limits.pids),
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=512m',
    '--env-file', paths.envFile,
    '-e', `MSSQL_PID=${edition}`,
    '-v', `${paths.bakFile}:${IN_CONTAINER_BAK}:ro`,
    '-v', `${paths.dataDir}:/var/opt/mssql/data`,
    '-v', `${paths.workDir}:/work`,
    '-v', `${paths.outDir}:/out`,
    image,
  ];
}

export const headerOnlySql = (): string => `SET NOCOUNT ON;\nRESTORE HEADERONLY FROM DISK = ${sqlString(IN_CONTAINER_BAK)};\n`;
export const fileListSql = (file: number): string => `SET NOCOUNT ON;\nRESTORE FILELISTONLY FROM DISK = ${sqlString(IN_CONTAINER_BAK)} WITH FILE = ${Math.trunc(file)};\n`;

export interface BackupFile {
  logicalName: string;
  type: string; // D data, L log, F fulltext, S filestream
  sizeBytes: number;
}

export function parseFileList(rows: HeaderRow[]): BackupFile[] {
  return rows.map((r) => ({ logicalName: String(r.LogicalName ?? ''), type: String(r.Type ?? ''), sizeBytes: Number(r.Size ?? 0) || 0 }));
}

/** Moves every file into the data dir under a neutral name. Filestream and full-text containers are refused. */
export function restoreSql(file: number, files: BackupFile[]): string {
  if (files.some((f) => f.type === 'S')) throw new Error('FILESTREAM data is not supported (documents stored outside the database file).');
  const moves = files
    .filter((f) => f.type === 'D' || f.type === 'L')
    .map((f, i) => `MOVE ${sqlString(f.logicalName)} TO ${sqlString(`/var/opt/mssql/data/rx_${i}.${f.type === 'L' ? 'ldf' : i === 0 ? 'mdf' : 'ndf'}`)}`);
  if (!files.some((f) => f.type === 'D')) throw new Error('The backup lists no data file.');
  return `SET NOCOUNT ON;\nRESTORE DATABASE ${sqlIdent(RESTORED_DB)} FROM DISK = ${sqlString(IN_CONTAINER_BAK)}\nWITH FILE = ${Math.trunc(file)}, ${moves.join(',\n  ')}, STATS = 10;\n`
    // FOR JSON needs compatibility level >= 130; the restored (old) level is irrelevant for read-only export.
    + `ALTER DATABASE ${sqlIdent(RESTORED_DB)} SET COMPATIBILITY_LEVEL = 150;\nALTER DATABASE ${sqlIdent(RESTORED_DB)} SET READ_ONLY WITH ROLLBACK IMMEDIATE;\n`;
}

export const inventorySql = (): string =>
  `SET NOCOUNT ON;\nUSE ${sqlIdent(RESTORED_DB)};\n` +
  `SELECT s.name AS SchemaName, t.name AS TableName, SUM(p.rows) AS RowCnt\n` +
  `FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id\n` +
  `JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)\n` +
  `WHERE t.is_ms_shipped = 0 GROUP BY s.name, t.name ORDER BY s.name, t.name;\n`;

export const columnsSql = (): string =>
  `SET NOCOUNT ON;\nUSE ${sqlIdent(RESTORED_DB)};\n` +
  `SELECT TABLE_SCHEMA AS SchemaName, TABLE_NAME AS TableName, COLUMN_NAME AS ColumnName, DATA_TYPE AS DataType\n` +
  `FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;\n`;

/** Types that must travel as strings (exact decimals) or be rendered to text (no JSON form). */
const AS_TEXT = new Set(['decimal', 'numeric', 'money', 'smallmoney', 'float', 'real', 'bigint']);
const TO_TEXT = new Set(['xml', 'hierarchyid', 'geography', 'geometry', 'sql_variant', 'text', 'ntext']);

export function exportExpression(column: string, type: string, alias = 'x'): string {
  const ref = `${alias}.${sqlIdent(column)}`;
  const t = type.toLowerCase();
  if (AS_TEXT.has(t)) return `CAST(${ref} AS nvarchar(64)) AS ${sqlIdent(column)}`;
  if (TO_TEXT.has(t)) return `CAST(${ref} AS nvarchar(max)) AS ${sqlIdent(column)}`;
  return `${ref} AS ${sqlIdent(column)}`;
}

/** One JSON object per row, each row a separate value so sqlcmd does not split it (the outer SELECT form). */
export function exportSql(schema: string, table: string, columns: { name: string; type: string }[]): string {
  const list = columns.map((c) => exportExpression(c.name, c.type)).join(', ');
  return (
    `SET NOCOUNT ON;\nUSE ${sqlIdent(RESTORED_DB)};\n` +
    `SELECT (SELECT ${list} FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES) FROM ${sqlIdent(schema)}.${sqlIdent(table)} AS x;\n`
  );
}

/** sqlcmd argv (run through `docker exec`). The password stays inside the container's environment. */
export function sqlcmdShell(scriptFile: string, outFile: string | null, tabular: boolean): string {
  const base = `${SQLCMD} -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -b -C -i ${scriptFile}`;
  const tail = tabular ? ` -W -s "${FIELD_SEPARATOR}"` : ` -h -1 -y 0 -W`;
  return `${base}${tail}${outFile ? ` -o ${outFile}` : ''}`;
}

/** Parses sqlcmd's column-aligned output (header, dashed line, rows). */
export function parseSqlcmdTable(stdout: string): HeaderRow[] {
  const lines = stdout.split(/\r?\n/).filter((l) => l.length > 0);
  const headerAt = lines.findIndex((l) => l.includes(FIELD_SEPARATOR));
  if (headerAt < 0) return [];
  const names = lines[headerAt].split(FIELD_SEPARATOR);
  const rows: HeaderRow[] = [];
  for (const line of lines.slice(headerAt + 2)) {
    if (/^\(\d+ rows? affected\)/.test(line)) continue;
    const cells = line.split(FIELD_SEPARATOR);
    const row: HeaderRow = {};
    names.forEach((n, i) => (row[n] = cells[i] === 'NULL' || cells[i] === undefined ? null : cells[i]));
    rows.push(row);
  }
  return rows;
}
