import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** Same rules as enterprise_hub/modules/data_import/migration/manifest.ts: the manifest is untrusted input. */
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.ndjson(\.gz)?$/;
export class ManifestError extends Error {}

export function parseManifest(m) {
  if (!m || m.version !== 1 || !m.source || !Array.isArray(m.tables)) throw new ManifestError('manifest: wrong shape or version');
  if (m.tables.length === 0 || m.tables.length > 5000) throw new ManifestError('manifest: table count out of range');
  const seen = new Set();
  for (const t of m.tables) {
    if (typeof t?.name !== 'string' || typeof t.schema !== 'string') throw new ManifestError('manifest: table without a name');
    if (!SAFE_FILE.test(String(t.file))) throw new ManifestError(`manifest: unsafe file name for ${t.name}`);
    if (!Number.isInteger(t.rows) || t.rows < 0) throw new ManifestError(`manifest: bad row count for ${t.name}`);
    if (!/^[0-9a-f]{64}$/.test(String(t.sha256))) throw new ManifestError(`manifest: bad sha256 for ${t.name}`);
    if (!Array.isArray(t.columns) || t.columns.length === 0 || t.columns.length > 1024 || t.columns.some((c) => typeof c?.name !== 'string' || c.name.length === 0)) throw new ManifestError(`manifest: bad columns for ${t.name}`);
    const key = `${t.schema}.${t.name}`.toLowerCase();
    if (seen.has(key) || seen.has(`f:${t.file}`)) throw new ManifestError(`manifest: duplicate table ${key}`);
    seen.add(key); seen.add(`f:${t.file}`);
  }
  return m;
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
