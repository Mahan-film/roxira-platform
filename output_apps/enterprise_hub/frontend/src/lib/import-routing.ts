/**
 * Where an import file goes, decided before anything is sent (#277).
 *
 * Production nginx caps one request under `/enterprise-hub/` at 16 MB, so only small spreadsheets,
 * PDFs and images go through the one-request preview. Everything else, and every file over about
 * 5 MB, goes up in resumable chunks through the whole-database tab. Files over 40 MB (the server's
 * package limit) go to the bulk streaming import when the server has it enabled.
 */

export type ImportRoute = "single" | "package" | "bulk";

/** Formats the one-request preview (`POST /data-import/preview`) reads. */
export const SINGLE_FILE_EXTENSIONS: readonly string[] = ["xlsx", "csv", "pdf", "jpg", "jpeg", "png"];

/** From this size a file goes up in chunks instead of one request. */
export const CHUNKED_FROM_BYTES = 5 * 1024 * 1024;

/** From this size a file goes to the bulk streaming import (server package default: 40 MB). */
export const BULK_FROM_BYTES = 40 * 1024 * 1024;

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
  if (file.size > BULK_FROM_BYTES && (bulkEnabled || file.size > CHUNKED_MAX_BYTES)) return "bulk";
  if (file.size > CHUNKED_FROM_BYTES) return "package";
  return SINGLE_FILE_EXTENSIONS.includes(extensionOf(file.name)) ? "single" : "package";
}

/** Storage key that lets a chunked upload of the same file resume after a reload or a network drop. */
export function chunkResumeKey(file: { name: string; size: number; lastModified: number }): string {
  return `roxira.import.upload:${file.name}:${file.size}:${file.lastModified}`;
}

const MB = 1024 * 1024;

/** Persian message for a file the server refused as too large (HTTP 413). */
export function tooLargeMessage(size: number): string {
  const mb = Math.ceil(size / MB);
  return size > BULK_FROM_BYTES
    ? `فایل ${mb} مگابایتی از سقف یک درخواست سرور بزرگ‌تر است. آن را از بخش «ورود حجیم» بالای همین صفحه بفرستید؛ آنجا تکه‌تکه و قابل ادامه بارگذاری می‌شود.`
    : `فایل ${mb} مگابایتی از سقف یک درخواست سرور بزرگ‌تر است. آن را در زبانهٔ «انتقال کامل دیتابیس» بفرستید تا تکه‌تکه بارگذاری شود.`;
}
