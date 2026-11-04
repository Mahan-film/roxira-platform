/**
 * Where an import file goes, decided before anything is sent (#277, #325).
 *
 * Production nginx caps one request under `/enterprise-hub/` at 16 MB, so only small spreadsheets,
 * PDFs and images go through the one-request preview. When the server has the bulk import enabled,
 * every file over about 5 MB and every database dump or archive goes there: resumable parts, then
 * the review gate in the «ورود حجیم» panel. Without it, the other files go up in chunks through
 * the whole-database tab (up to its 120 MB limit).
 */

export type ImportRoute = "single" | "package" | "bulk";

/** Formats the one-request preview (`POST /data-import/preview`) reads. */
export const SINGLE_FILE_EXTENSIONS: readonly string[] = ["xlsx", "csv", "pdf", "jpg", "jpeg", "png"];

/** From this size a file goes up in chunks instead of one request. */
export const CHUNKED_FROM_BYTES = 5 * 1024 * 1024;

/** Database dumps and archives always take the bulk path when it is enabled (#325). */
const BULK_EXTENSIONS: readonly string[] = ["sql", "zip", "sqlite", "db"];

/** Largest file the chunked package upload takes (server `IMPORT_MAX_FILE_BYTES` default). */
export const CHUNKED_MAX_BYTES = 120 * 1024 * 1024;

/** Support-matrix statuses whose extensions the file picker offers. */
const ACCEPTED_STATUSES = new Set(["supported", "partial", "heuristic"]);

/**
 * Used only while `GET /data-import/formats` cannot be read: the single-file formats plus the
 * formats the whole-database tab reads.
 */
export const FALLBACK_ACCEPT =
  ".csv,.db,.dbf,.iif,.jpeg,.jpg,.json,.ods,.ofx,.pdf,.png,.prn,.qbo,.qfx,.sql,.sqlite,.tsv,.txt,.webp,.xls,.xlsx,.xml,.zip";

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The `accept` attribute from the server's support matrix: every readable extension, once. */
export function acceptFromFormats(rows: ReadonlyArray<{ extensions: string[]; status: string }>): string {
  const extensions = new Set<string>();
  for (const row of rows) {
    if (!ACCEPTED_STATUSES.has(row.status)) continue;
    for (const ext of row.extensions) {
      const clean = ext.trim().toLowerCase().replace(/^\.?/, ".");
      if (clean.length > 1) extensions.add(clean);
    }
  }
  return extensions.size > 0 ? [...extensions].sort().join(",") : FALLBACK_ACCEPT;
}

export function routeImportFile(file: { name: string; size: number }, bulkEnabled: boolean): ImportRoute {
  const ext = extensionOf(file.name);
  if (bulkEnabled && (file.size > CHUNKED_FROM_BYTES || BULK_EXTENSIONS.includes(ext))) return "bulk";
  if (file.size > CHUNKED_MAX_BYTES) return "bulk";
  if (file.size > CHUNKED_FROM_BYTES) return "package";
  return SINGLE_FILE_EXTENSIONS.includes(ext) ? "single" : "package";
}

/** Storage key under which the bulk job of this file is kept, so picking it again after a reload resumes. */
export function chunkResumeKey(file: { name: string; size: number; lastModified: number }): string {
  return `roxira.import.bulk-job:${file.name}:${file.size}:${file.lastModified}`;
}
