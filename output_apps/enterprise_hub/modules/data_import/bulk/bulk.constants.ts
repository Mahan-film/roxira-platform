/**
 * Constants and env-driven settings of the bulk (streaming) import path.
 *
 * Nothing here caps rows or files per day. The only ceiling is the per-tenant storage quota, which is a
 * config value (`IMPORT_TENANT_QUOTA_BYTES`). Hostile-file guards (zip bombs, runaway quoted fields,
 * oversized cells) stay on because they protect the server, not the customer.
 */

export const BULK_QUEUE_NAME = 'bulk-import';
export const BULK_RUN_JOB = 'bulk-run';
export const BULK_POST_JOB = 'bulk-post';
export const BULK_CLEANUP_JOB = 'bulk-cleanup';
export const BULK_SWEEP_JOB = 'bulk-sweep';

export const GIB = 1024 * 1024 * 1024;
export const MIB = 1024 * 1024;

/** R2/S3 multipart minimum part size (the last part may be smaller). */
export const MIN_PART_BYTES = 5 * MIB;
/** S3/R2 multipart ceiling: 10 000 parts. */
export const MAX_PARTS = 10_000;

/** Rows per staging INSERT. Bounds memory and keeps each transaction short. */
export const STAGING_BATCH_ROWS = 5_000;
/** Soft cap of one staging batch in characters, so very wide rows cannot blow the batch up. */
export const STAGING_BATCH_CHARS = 24 * MIB;
/** How often the runner polls the pause/cancel flag (ms). */
export function progressIntervalMs(): number {
  return positive('IMPORT_BULK_POLL_MS', 1_000);
}

/** A single CSV record longer than this is a runaway quote or a hostile file, never data. */
export const MAX_RECORD_CHARS = 4 * MIB;
export const MAX_CELL_CHARS = 32_768;
export const MAX_COLUMNS = 512;
/** A single SQL statement (other than INSERT/COPY, which are streamed) kept for CREATE TABLE parsing. */
export const MAX_DDL_CHARS = 256 * 1024;

export const RESERVED_PRESIGN_SECONDS = 6 * 60 * 60;

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function positive(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** Per-tenant storage quota (bytes of uploaded sources kept for the tenant). Default 50 GiB. */
export function tenantQuotaBytes(): number {
  return positive('IMPORT_TENANT_QUOTA_BYTES', 50 * GIB);
}

/** Size of one multipart part. Default 64 MiB, so a 5 GB file is ~80 parts. */
export function partBytes(): number {
  return Math.max(MIN_PART_BYTES, positive('IMPORT_PART_BYTES', 64 * MIB));
}

/** Largest single file accepted. Default 1 TiB: a sanity bound, not a product limit. */
export function maxFileBytes(): number {
  return positive('IMPORT_BULK_MAX_FILE_BYTES', 1024 * GIB);
}

export function maxZipEntries(): number {
  return positive('IMPORT_BULK_MAX_ZIP_ENTRIES', 20_000);
}

/** Total bytes a ZIP may expand to. Default 200 GiB. */
export function maxUncompressedBytes(): number {
  return positive('IMPORT_BULK_MAX_UNCOMPRESSED_BYTES', 200 * GIB);
}

/** Expansion ratio above which a ZIP entry is treated as a bomb (checked after 256 MiB of output). */
export function maxExpansionRatio(): number {
  return positive('IMPORT_BULK_MAX_EXPANSION_RATIO', 1_000);
}

/** Cap on shared strings kept for one XLSX workbook (they are spooled to disk beyond this). */
export function xlsxStringsInMemory(): number {
  return positive('IMPORT_BULK_XLSX_STRINGS_IN_MEMORY', 200_000);
}

/**
 * Where XLSX shared strings and ZIP-nested workbooks spill to disk. In production `/tmp` is a RAM tmpfs
 * inside a 900 MB container, so the compose file mounts a real disk folder and points
 * IMPORT_BULK_SPOOL_DIR at it; if that folder is missing or not writable we fall back to the OS temp dir.
 */
export function bulkTmpDir(): string {
  const raw = process.env.IMPORT_BULK_SPOOL_DIR;
  if (raw && raw.trim()) {
    try {
      fs.accessSync(raw, fs.constants.W_OK);
      return raw;
    } catch {
      /* fall through */
    }
  }
  return os.tmpdir();
}

/**
 * Parts relayed through the API (streamed to storage, never to disk) when the browser cannot reach R2.
 * On by default for the S3 driver; set IMPORT_PROXY_PARTS=0 to forbid it.
 */
export function proxyPartsEnabled(): boolean {
  return process.env.IMPORT_PROXY_PARTS !== '0';
}

/** Largest relayed part the API accepts (must stay below nginx's limit for that route and Cloudflare's 100 MB). */
export const MAX_PROXY_PART_BYTES = 96 * MIB;

/**
 * Per-part SHA-256 bound into presigned URLs. Off by default until `scripts/ops/huge_import_probe.mjs`
 * has confirmed the real R2 bucket enforces the header; then set IMPORT_PART_CHECKSUMS=1.
 */
export function partChecksumsEnabled(): boolean {
  return process.env.IMPORT_PART_CHECKSUMS === '1';
}

/**
 * Ceiling for ALL staged rows in PostgreSQL (`bulk_import_rows`, all tenants). Staged rows are ~1.4x the CSV that
 * produced them and live on the database host's disk, which is the real limit of a huge import. A job that would
 * push the table over this stops with a clear message and resumes where it stopped once space is free.
 * Default 6 GiB for srv1 (about 16 GB free); raise it when the data volume is bigger.
 */
export function stagingMaxBytes(): number {
  return positive('IMPORT_STAGING_MAX_BYTES', 6 * GIB);
}

export function maxActiveJobsPerTenant(): number {
  return positive('IMPORT_BULK_MAX_ACTIVE_JOBS', 5);
}

export type StorageDriver = 's3' | 'local' | 'disabled';

/**
 * `s3` when all four R2 values are set. `local` only outside production (developer machines, tests
 * and the benchmark). In production without R2 the feature reports itself as not configured.
 */
export function storageDriver(): StorageDriver {
  const forced = process.env.IMPORT_STORAGE_DRIVER;
  if (forced === 's3' || forced === 'local' || forced === 'disabled') return forced;
  if (r2Configured()) return 's3';
  return process.env.NODE_ENV === 'production' ? 'disabled' : 'local';
}

export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

export function localStorageRoot(): string {
  const raw = process.env.IMPORT_LOCAL_STORAGE_DIR;
  return raw && raw.trim() ? raw : path.join(bulkTmpDir(), 'roxira-bulk-objects');
}
