/**
 * Reads the result of `RESTORE HEADERONLY` and decides what to do with a SQL Server backup BEFORE any restore
 * is attempted. Pure functions: the rows come from `sqlcmd` output parsed by the caller.
 *
 * SoftwareVersionMajor: 8 = 2000, 9 = 2005, 10 = 2008 / 2008 R2, 11 = 2012, 12 = 2014, 13 = 2016, 14 = 2017,
 * 15 = 2019, 16 = 2022. A server can only restore backups of its own or an older version; 2000 and 2005
 * backups are rejected by every supported Linux image with error 3169 (old Holoo installs).
 */
export interface HeaderRow {
  [column: string]: string | number | null | undefined;
}

export interface BakSet {
  position: number;
  backupType: number; // 1 = full database, 2 = log, 5 = differential
  databaseName: string;
  softwareVersionMajor: number;
  databaseVersion: number;
  collation: string | null;
  compressed: boolean;
  encrypted: boolean;
  backupSizeBytes: number;
  backupFinishDate: string | null;
}

export type BakRoute =
  | { route: 'restore'; set: BakSet; sqlGeneration: string }
  | { route: 'legacy-extractor'; reason: string; sqlGeneration: string }
  | { route: 'unsupported'; reason: string };

const GENERATION: Record<number, string> = {
  8: 'SQL Server 2000',
  9: 'SQL Server 2005',
  10: 'SQL Server 2008 / 2008 R2',
  11: 'SQL Server 2012',
  12: 'SQL Server 2014',
  13: 'SQL Server 2016',
  14: 'SQL Server 2017',
  15: 'SQL Server 2019',
  16: 'SQL Server 2022',
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const flag = (v: unknown): boolean => v === 1 || v === '1' || v === true || String(v).toLowerCase() === 'true';

export function parseHeaderOnly(rows: HeaderRow[]): BakSet[] {
  return rows.map((r) => ({
    position: num(r.Position),
    backupType: num(r.BackupType),
    databaseName: String(r.DatabaseName ?? ''),
    softwareVersionMajor: num(r.SoftwareVersionMajor),
    databaseVersion: num(r.DatabaseVersion),
    collation: r.Collation ? String(r.Collation) : null,
    compressed: flag(r.Compressed),
    // KeyAlgorithm / EncryptorThumbprint are present from 2014; empty or NULL when not encrypted.
    encrypted: Boolean(r.KeyAlgorithm && String(r.KeyAlgorithm).trim() && String(r.KeyAlgorithm).toUpperCase() !== 'NULL'),
    backupSizeBytes: num(r.BackupSize),
    backupFinishDate: r.BackupFinishDate ? String(r.BackupFinishDate) : null,
  }));
}

/** SQL Server prints `Msg 3169 ... was created on a server running version X` for 2000/2005 backups. */
export function isLegacyVersionError(output: string): boolean {
  return /\b3169\b/.test(output) || /(?:version|database version)\s*(?:539|611|612)\b/i.test(output);
}

export function generationName(major: number): string {
  return GENERATION[major] ?? `SQL Server (major ${major})`;
}

/**
 * Picks the backup set to restore and the route. The newest full backup in the file wins (`.bak` files often
 * hold several sets). A file with only differential or log backups cannot be restored on its own.
 */
export function chooseRoute(sets: BakSet[], options: { maxMajor?: number } = {}): BakRoute {
  const maxMajor = options.maxMajor ?? 15;
  if (sets.length === 0) return { route: 'unsupported', reason: 'The file has no backup sets (not a SQL Server backup, or damaged).' };
  const fulls = sets.filter((s) => s.backupType === 1);
  if (fulls.length === 0) {
    const kinds = [...new Set(sets.map((s) => (s.backupType === 5 ? 'differential' : s.backupType === 2 ? 'transaction log' : `type ${s.backupType}`)))];
    return { route: 'unsupported', reason: `Only ${kinds.join(', ')} backups found. A full database backup is required.` };
  }
  const set = fulls.reduce((a, b) => (b.position > a.position ? b : a));
  const sqlGeneration = generationName(set.softwareVersionMajor);
  if (set.softwareVersionMajor > 0 && set.softwareVersionMajor < 10) {
    return {
      route: 'legacy-extractor',
      sqlGeneration,
      reason: `${sqlGeneration} backups cannot be restored on a modern server (error 3169). Use the Windows extractor on a machine that runs the source database.`,
    };
  }
  if (set.encrypted) return { route: 'unsupported', reason: 'The backup is encrypted. Ask the customer for an unencrypted backup or the Windows extractor.' };
  if (set.softwareVersionMajor > maxMajor) {
    return { route: 'unsupported', reason: `The backup comes from ${sqlGeneration}, newer than the restore image supports (up to major ${maxMajor}).` };
  }
  return { route: 'restore', set, sqlGeneration };
}
