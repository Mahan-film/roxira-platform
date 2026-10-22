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
 */
import { ApiClientError, apiRequest, apiUpload } from "@/lib/api/http-client";
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
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_EXTENSIONS = ["xlsx", "csv", "pdf", "jpg", "jpeg", "png"];

/** Returns a Persian error message when the file cannot be imported, else null. */
export function validateImportFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return "فرمت فایل پشتیبانی نمی‌شود. فقط xlsx، csv، pdf، jpg و png پذیرفته می‌شود.";
  }
  if (file.size > IMPORT_MAX_BYTES) {
    return "حجم فایل بیش از ۵ مگابایت است.";
  }
  if (file.size === 0) {
    return "فایل خالی است.";
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
