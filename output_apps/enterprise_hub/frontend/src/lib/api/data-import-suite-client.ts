/**
 * Typed client for the multi-entity AI import (Business Suite phase 1).
 * Single file on purpose: the backend contract is being finished in parallel,
 * so every endpoint shape lives here and is easy to adjust.
 *
 *   GET  /enterprise-hub/data-import/entities
 *   POST /enterprise-hub/data-import/preview   (multipart: file, entity?)
 *   POST /enterprise-hub/data-import/commit
 *   POST /enterprise-hub/data-import/batches/:batchId/undo
 *   GET  /enterprise-hub/data-import/batches
 *
 * Whole-database migration ("database package import") shares the same base:
 *
 *   POST /enterprise-hub/data-import/packages            (multipart: file)
 *   GET  /enterprise-hub/data-import/packages/:id
 *   POST /enterprise-hub/data-import/packages/:id/commit
 *   GET  /enterprise-hub/data-import/packages/:id/progress
 */
import {
  ApiClientError,
  apiPutRaw,
  apiRequest,
  apiUpload,
  apiUploadWithProgress,
  type UploadProgressOptions,
} from "@/lib/api/http-client";
import {
  API_PROXY_BASE_PATH,
  DATA_IMPORT_RESOURCE_PATH,
} from "@/lib/api/config";

const BASE = `${API_PROXY_BASE_PATH}/${DATA_IMPORT_RESOURCE_PATH}`;

export interface ImportFieldDef {
  key: string;
  labelFa: string;
  required: boolean;
  type: string;
  enumValues?: string[];
}

export interface ImportEntityDef {
  key: string;
  labelFa: string;
  fields: ImportFieldDef[];
}

export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

/** A sample row is either positional (aligned with `headers`) or keyed by header. */
export type ImportSampleRow =
  | Array<string | number | null>
  | Record<string, unknown>;

export interface ImportPreview {
  uploadId: string;
  detectedEntity: string;
  confidence: number;
  headers: string[];
  mapping: Record<string, string | null>;
  sampleRows: ImportSampleRow[];
  rowCount: number;
  errors: ImportRowError[];
}

export interface ImportCommitRequest {
  uploadId: string;
  entity: string;
  mapping: Record<string, string | null>;
  /** Target bank account (only for the `bank-statement` entity). */
  bankAccountId?: number;
}

export interface ImportCommitResult {
  batchId: string;
  inserted: number;
  skippedDuplicates: number;
  failed: Array<{ row: number; message: string }>;
}

export interface ImportBatch {
  batchId: string;
  entity: string;
  fileName: string;
  inserted: number;
  createdAt: string;
  undone: boolean;
}

export const IMPORT_ACCEPT = ".xlsx,.csv,.pdf,.jpg,.jpeg,.png";

/** سقف حجم صفحه‌گسترده (XLSX/CSV): ۱۰ مگابایت. */
export const IMPORT_MAX_SHEET_BYTES = 10 * 1024 * 1024;

/** سقف حجم PDF/تصویر: ۱۵ مگابایت. */
export const IMPORT_MAX_DOC_BYTES = 15 * 1024 * 1024;

/** سقف بزرگ‌ترین نوع فایل (برای اعلام کلی در رابط کاربری). */
export const IMPORT_MAX_BYTES = IMPORT_MAX_DOC_BYTES;

/** سقف تعداد ردیف هر فایل: ۲۰٬۰۰۰. */
export const IMPORT_MAX_ROWS = 20000;

/** سقف تعداد فایل ورودی روزانه هر سازمان: ۲۰. */
export const IMPORT_DAILY_FILES = 20;

const SHEET_EXTENSIONS = ["xlsx", "csv"];
const DOC_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
const ALLOWED_EXTENSIONS = [...SHEET_EXTENSIONS, ...DOC_EXTENSIONS];

/** Returns a Persian error message when the file cannot be imported, else null. */
export function validateImportFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return "فرمت فایل پشتیبانی نمی‌شود. فقط xlsx، csv، pdf، jpg و png پذیرفته می‌شود.";
  }
  if (file.size === 0) {
    return "فایل خالی است.";
  }
  const isSheet = SHEET_EXTENSIONS.includes(ext);
  const maxBytes = isSheet ? IMPORT_MAX_SHEET_BYTES : IMPORT_MAX_DOC_BYTES;
  if (file.size > maxBytes) {
    return isSheet
      ? "حجم فایل اکسل/CSV بیش از ۱۰ مگابایت است."
      : "حجم فایل PDF/تصویر بیش از ۱۵ مگابایت است.";
  }
  return null;
}

/** Persian message for a failed import call; 404/502/503 mean the service is not up yet. */
export function importErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (
      error.statusCode === 404 ||
      error.statusCode === 502 ||
      error.statusCode === 503
    ) {
      return "سرویس ورود داده در حال حاضر در دسترس نیست. کمی بعد دوباره تلاش کنید.";
    }
    return error.details.join(" | ");
  }
  return "ارتباط با سرور برقرار نشد. اینترنت خود را بررسی کنید و دوباره تلاش کنید.";
}

export function listImportEntities(
  signal?: AbortSignal,
): Promise<ImportEntityDef[]> {
  return apiRequest<ImportEntityDef[]>(`${BASE}/entities`, { signal });
}

export function previewImport(
  file: File,
  entity?: string,
  signal?: AbortSignal,
): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file);
  if (entity) form.append("entity", entity);
  return apiUpload<ImportPreview>(`${BASE}/preview`, form, signal);
}

export function commitImport(
  payload: ImportCommitRequest,
  signal?: AbortSignal,
): Promise<ImportCommitResult> {
  return apiRequest<ImportCommitResult>(`${BASE}/commit`, {
    method: "POST",
    body: payload,
    signal,
  });
}

export function undoImportBatch(
  batchId: string,
  signal?: AbortSignal,
): Promise<{ removed: number }> {
  return apiRequest<{ removed: number }>(
    `${BASE}/batches/${encodeURIComponent(batchId)}/undo`,
    { method: "POST", signal },
  );
}

export function listImportBatches(
  signal?: AbortSignal,
): Promise<ImportBatch[]> {
  return apiRequest<ImportBatch[]>(`${BASE}/batches`, { signal });
}

/* ------------------------------------------------------------------ *
 * Database package import (whole-company migration)
 * ------------------------------------------------------------------ */

/** پسوندهای مجاز بستهٔ دیتابیس. */
export const PACKAGE_ACCEPT = "";

/** سقف حجم هر فایل در بارگذاری تکه‌ای: ۱۲۰ مگابایت (هماهنگ با IMPORT_MAX_FILE_BYTES سرور). */
export const PACKAGE_MAX_BYTES = 120 * 1024 * 1024;

/** سقف جمع حجم یک بستهٔ چندفایلی/پوشه: ۲۰۰ مگابایت و ۲۰۰ فایل. */
export const PACKAGE_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const PACKAGE_MAX_FILES = 200;

/** اندازهٔ هر تکه: ۴ مگابایت (کمتر از سقف ۱۰ مگابایتی پروکسی Next). */
export const PACKAGE_CHUNK_BYTES = 4 * 1024 * 1024;

export type ImportPackageStatus =
  | "analyzing"
  | "ready"
  | "failed"
  | "committing"
  | "committed";

export interface ImportPackageColumn {
  name: string;
  type: string;
  sample: Array<string | number | null>;
}

export interface ImportPackageTable {
  name: string;
  rowCount: number;
  columns: ImportPackageColumn[];
  detectedEntity: string | null;
  confidence: number;
  mapping: Record<string, string | null>;
  skipped?: boolean;
  reason?: string;
  mappingSource?: "heuristic" | "reader" | "profile" | "memory";
  profileId?: string;
  profileEvidence?: "proven" | "heuristic";
  notesFa?: string[];
  moneyUnit?: {
    unit: "rial" | "toman" | "unknown";
    toRial: number | null;
    evidence: string;
    column?: string;
  };
  dateSystem?: "jalali" | "gregorian" | "mixed" | "unknown";
}

export interface ImportPackageRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  matchRatio: number;
  declared: boolean;
}

export type ImportHealthLevel = "ok" | "warn" | "error";

export interface ImportPackageHealthCheck {
  key: string;
  level: ImportHealthLevel;
  titleFa: string;
  detailFa: string;
  value?: string | number;
}

export interface ImportPackageCurrency {
  raw: string;
  normalized: string;
  count: number;
}

export interface ImportPackageDetail {
  packageId: string;
  status: ImportPackageStatus;
  error?: string;
  tables: ImportPackageTable[];
  relationships: ImportPackageRelationship[];
  health: { checks: ImportPackageHealthCheck[] };
  currencies: ImportPackageCurrency[];
  /** قالب تشخیص‌داده‌شده از محتوا + یادداشت‌های خواننده. */
  format?: { id: string; notes: string[]; ocr?: boolean };
}

export interface ImportPackageCreated {
  packageId: string;
  status: "analyzing";
}

export interface ImportPackageCommitTable {
  name: string;
  entity: string;
  mapping: Record<string, string | null>;
  skip?: boolean;
  /** ضریب تبدیل مبلغ‌های بدون واحد به ریال (۱۰ = تومان). */
  moneyToRial?: number;
}

export interface ImportPackageCommitRequest {
  tables: ImportPackageCommitTable[];
  /** فقط مدیر/مالک: ثبت با وجود عدم‌تراز. سرور دوباره می‌سنجد. */
  confirmImbalance?: boolean;
}

export interface ImportTableReconciliation {
  name: string;
  entity: string;
  rowCount: number;
  validRows: number;
  invalidRows: number;
  duplicateRowsInFile: number;
  unmappedColumns: string[];
  moneyToRial: number;
  totals?: { debit: number; credit: number; difference: number };
  unbalancedVouchers?: number;
  unbalancedSample?: Array<{ voucher: string; difference: number }>;
  warningsFa: string[];
}

export interface ImportReconciliationReport {
  key: string;
  tables: ImportTableReconciliation[];
  totals: { debit: number; credit: number; difference: number };
  balanced: boolean;
  blockersFa: string[];
  warningsFa: string[];
}

export type ImportSupportStatus =
  | "supported"
  | "partial"
  | "heuristic"
  | "guide"
  | "unsupported";

export interface ImportSupportRow {
  id: string;
  group: string;
  titleFa: string;
  extensions: string[];
  status: ImportSupportStatus;
  detailFa: string;
  fixture?: string;
}

export interface ImportPackageCommitResult {
  batchId: string;
}

export interface ImportPackageProgress {
  phase: string;
  done: number;
  total: number;
  inserted: Record<string, number>;
  skipped: Record<string, number>;
  errors: string[];
}

/** برچسب فارسی کلیدهای شناخته‌شدهٔ موجودیت‌ها (پشتیبان فهرست سرور). */
export const PACKAGE_ENTITY_LABELS: Record<string, string> = {
  "crm-leads": "سرنخ‌های CRM",
  "hr-employees": "کارکنان",
  "inventory-items": "کالاها",
  "accounting-accounts": "حساب‌ها",
  "accounting-opening-balances": "موجودی اولیه حساب‌ها",
  "accounting-journal-lines": "ردیف اسناد حسابداری",
  "sales-invoices": "فاکتورهای فروش",
  "crm-activities": "فعالیت‌های CRM",
};

/** برچسب فارسی یک کلید موجودیت؛ در نبود نگاشت، خود کلید بازگردانده می‌شود. */
export function packageEntityLabel(key: string): string {
  return PACKAGE_ENTITY_LABELS[key] ?? key;
}

/** پیام خطای فارسی برای فایلی که نمی‌شود فرستاد؛ قالب را سرور از روی «محتوا» تشخیص می‌دهد، نه پسوند. */
export function validatePackageFile(file: File): string | null {
  if (file.size === 0) {
    return "فایل خالی است.";
  }
  if (file.size > PACKAGE_MAX_BYTES) {
    return `حجم فایل «${file.name}» بیش از ${Math.round(PACKAGE_MAX_BYTES / 1024 / 1024)} مگابایت است.`;
  }
  return null;
}

/** اعتبارسنجی مجموعهٔ فایل‌ها (پوشه یا چند فایل). */
export function validatePackageFiles(files: File[]): string | null {
  if (files.length === 0) return "فایلی انتخاب نشده است.";
  if (files.length > PACKAGE_MAX_FILES) {
    return `حداکثر ${PACKAGE_MAX_FILES} فایل در هر بسته مجاز است.`;
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > PACKAGE_MAX_TOTAL_BYTES) {
    return `مجموع حجم فایل‌ها بیش از ${Math.round(PACKAGE_MAX_TOTAL_BYTES / 1024 / 1024)} مگابایت است.`;
  }
  for (const file of files) {
    const invalid = validatePackageFile(file);
    if (invalid) return invalid;
  }
  return null;
}

interface UploadStatus {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  missing: number[];
}

const CHUNK_RETRIES = 3;

/**
 * بارگذاری تکه‌ای و قابل‌ازسرگیری یک فایل. اگر اتصال قطع شود، وضعیت سرور خوانده می‌شود و فقط تکه‌های
 * جاافتاده دوباره فرستاده می‌شوند. شناسهٔ بارگذاری برگردانده می‌شود.
 */
export async function uploadFileChunked(
  file: File,
  options: UploadProgressOptions = {},
): Promise<string> {
  const init = await apiRequest<UploadStatus>(`${BASE}/uploads`, {
    method: "POST",
    body: { fileName: file.name, size: file.size, chunkSize: PACKAGE_CHUNK_BYTES },
    signal: options.signal,
  });
  let status = init;
  let sent = init.totalChunks - init.missing.length;
  for (let attempt = 0; status.missing.length > 0; attempt += 1) {
    if (attempt > CHUNK_RETRIES) {
      throw new ApiClientError(0, { message: "ارتباط با سرور بارها قطع شد؛ بارگذاری ناتمام ماند." });
    }
    try {
      for (const index of status.missing) {
        const blob = file.slice(index * status.chunkSize, (index + 1) * status.chunkSize);
        await apiPutRaw<UploadStatus>(
          `${BASE}/uploads/${encodeURIComponent(init.uploadId)}/chunks/${index}`,
          blob,
          options.signal,
        );
        sent += 1;
        options.onProgress?.(Math.round((sent / init.totalChunks) * 100));
      }
      status = { ...status, missing: [] };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (error instanceof ApiClientError && error.statusCode >= 400 && error.statusCode < 500) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      status = await apiRequest<UploadStatus>(
        `${BASE}/uploads/${encodeURIComponent(init.uploadId)}`,
        { signal: options.signal },
      );
      sent = status.totalChunks - status.missing.length;
    }
  }
  return init.uploadId;
}

/** ساخت بسته از بارگذاری‌های تکه‌ای کامل (یک فایل، چند فایل یا پوشه). */
export function createImportPackageFromUploads(
  uploadIds: string[],
  signal?: AbortSignal,
): Promise<ImportPackageCreated> {
  return apiRequest<ImportPackageCreated>(`${BASE}/packages/from-uploads`, {
    method: "POST",
    body: { uploadIds },
    signal,
  });
}

/** مغایرت‌گیری پیش از ثبت. */
export function reconcileImportPackage(
  packageId: string,
  payload: ImportPackageCommitRequest,
  signal?: AbortSignal,
): Promise<ImportReconciliationReport> {
  return apiRequest<ImportReconciliationReport>(
    `${BASE}/packages/${encodeURIComponent(packageId)}/reconcile`,
    { method: "POST", body: payload, signal },
  );
}

export interface ImportReviewVoucher {
  voucherNo: string;
  date: string;
  sourceTable: string;
  lines: Array<{ accountCode: string; description: string; debit: number; credit: number }>;
  debit: number;
  credit: number;
  balanced: boolean;
}

export interface ImportReviewGroup {
  bucket: string;
  labelFa: string;
  rows: number;
  validRows: number;
  invalidRows: number;
  tables: Array<{ name: string; entity: string }>;
  sample: Array<Record<string, unknown>>;
  errorsFa: string[];
}

export interface ImportPackageReview {
  ocr: boolean;
  key: string;
  groups: ImportReviewGroup[];
  skippedTables: string[];
  vouchers: { total: number; unbalanced: number; page: number; pageSize: number; items: ImportReviewVoucher[] };
}

/** بازبینی پیش از ثبت: گروه‌ها و یک صفحه از همهٔ سندهای پیشنهادی. */
export function reviewImportPackage(
  packageId: string,
  payload: ImportPackageCommitRequest,
  page: number,
  signal?: AbortSignal,
): Promise<ImportPackageReview> {
  return apiRequest<ImportPackageReview>(
    `${BASE}/packages/${encodeURIComponent(packageId)}/review?page=${page}`,
    { method: "POST", body: payload, signal },
  );
}

/** جدول صادقانهٔ قالب‌های پشتیبانی‌شده (از سرور؛ منبع حقیقت). */
export function listImportFormats(signal?: AbortSignal): Promise<ImportSupportRow[]> {
  return apiRequest<ImportSupportRow[]>(`${BASE}/formats`, { signal });
}

/** بارگذاری بستهٔ دیتابیس و آغاز تحلیل در پس‌زمینه. */
export function createImportPackage(
  file: File,
  options: UploadProgressOptions = {},
): Promise<ImportPackageCreated> {
  const form = new FormData();
  form.append("file", file);
  return apiUploadWithProgress<ImportPackageCreated>(
    `${BASE}/packages`,
    form,
    options,
  );
}

/** وضعیت و نتیجهٔ تحلیل یک بسته. */
export function getImportPackage(
  packageId: string,
  signal?: AbortSignal,
): Promise<ImportPackageDetail> {
  return apiRequest<ImportPackageDetail>(
    `${BASE}/packages/${encodeURIComponent(packageId)}`,
    { signal },
  );
}

/** ثبت بسته در دیتابیس (صف‌بندی‌شده) و دریافت شناسهٔ دستهٔ ورود. */
export function commitImportPackage(
  packageId: string,
  payload: ImportPackageCommitRequest,
  signal?: AbortSignal,
): Promise<ImportPackageCommitResult> {
  return apiRequest<ImportPackageCommitResult>(
    `${BASE}/packages/${encodeURIComponent(packageId)}/commit`,
    { method: "POST", body: payload, signal },
  );
}

/** پیشرفت ثبت هر موجودیت در بسته. */
export function getImportPackageProgress(
  packageId: string,
  signal?: AbortSignal,
): Promise<ImportPackageProgress> {
  return apiRequest<ImportPackageProgress>(
    `${BASE}/packages/${encodeURIComponent(packageId)}/progress`,
    { signal },
  );
}
