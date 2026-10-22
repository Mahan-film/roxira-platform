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
export const PACKAGE_ACCEPT = ".sqlite,.sqlite3,.db,.sql,.zip";

/** سقف حجم بستهٔ دیتابیس: ۴۰ مگابایت (هماهنگ با IMPORT_MAX_PACKAGE_BYTES). */
export const PACKAGE_MAX_BYTES = 40 * 1024 * 1024;

const PACKAGE_EXTENSIONS = ["sqlite", "sqlite3", "db", "sql", "zip"];

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
}

export interface ImportPackageCommitRequest {
  tables: ImportPackageCommitTable[];
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

/** Returns a Persian error message when the package file cannot be imported, else null. */
export function validatePackageFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!PACKAGE_EXTENSIONS.includes(ext)) {
    return "فرمت بسته پشتیبانی نمی‌شود. فقط sqlite، sqlite3، db، sql و zip پذیرفته می‌شود.";
  }
  if (file.size === 0) {
    return "فایل خالی است.";
  }
  if (file.size > PACKAGE_MAX_BYTES) {
    return "حجم بستهٔ دیتابیس بیش از ۴۰ مگابایت است.";
  }
  return null;
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
