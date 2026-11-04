/**
 * The hand-over format between "get the customer's tables out" (SQL Server .bak restore in a sandbox, or the
 * Windows extractor) and "transform + load" (DuckDB worker). One NDJSON file per table (one JSON object per
 * line, optionally `.gz`) plus this manifest. NDJSON is dependency-free for a customer's Windows machine;
 * Parquet is produced from it server-side by DuckDB.
 *
 * Decimal, money, float and bigint columns are exported as JSON *strings* so no amount ever passes through a
 * double (the certificate checks totals to the rial).
 */
export interface ManifestColumn {
  name: string;
  /** Source type name as the source system reports it (`nvarchar`, `decimal`, ...). */
  type: string;
}

export interface ManifestTable {
  schema: string;
  name: string;
  rows: number;
  /** Relative path of the NDJSON(.gz) file. */
  file: string;
  sha256: string;
  columns: ManifestColumn[];
}

export interface MigrationManifest {
  version: 1;
  source: {
    kind: 'bak' | 'extractor';
    /** SQL Server major version of the source (8 = 2000, 9 = 2005, 10 = 2008/R2, ...). */
    sqlMajor: number | null;
    databaseName: string;
    collation: string | null;
    createdAt: string;
  };
  tables: ManifestTable[];
}

export class ManifestError extends Error {}

const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.ndjson(\.gz)?$/;

/** Validates untrusted JSON (the extractor runs on a customer machine) before anything reads a file it names. */
export function parseManifest(raw: unknown): MigrationManifest {
  const m = raw as Partial<MigrationManifest> | null;
  if (!m || m.version !== 1 || !m.source || !Array.isArray(m.tables)) throw new ManifestError('manifest: wrong shape or version');
  if (m.source.kind !== 'bak' && m.source.kind !== 'extractor') throw new ManifestError('manifest: unknown source kind');
  if (m.tables.length === 0 || m.tables.length > 5000) throw new ManifestError('manifest: table count out of range');
  const seen = new Set<string>();
  for (const t of m.tables) {
    if (typeof t?.name !== 'string' || typeof t.schema !== 'string') throw new ManifestError('manifest: table without a name');
    if (!SAFE_FILE.test(String(t.file))) throw new ManifestError(`manifest: unsafe file name for ${t.name}`);
    if (!Number.isInteger(t.rows) || t.rows < 0) throw new ManifestError(`manifest: bad row count for ${t.name}`);
    if (!/^[0-9a-f]{64}$/.test(String(t.sha256))) throw new ManifestError(`manifest: bad sha256 for ${t.name}`);
    if (!Array.isArray(t.columns) || t.columns.length === 0 || t.columns.length > 1024) throw new ManifestError(`manifest: bad columns for ${t.name}`);
    const key = `${t.schema}.${t.name}`.toLowerCase();
    if (seen.has(key) || seen.has(`f:${t.file}`)) throw new ManifestError(`manifest: duplicate table ${key}`);
    seen.add(key);
    seen.add(`f:${t.file}`);
  }
  return m as MigrationManifest;
}
