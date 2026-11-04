/**
 * Client for the bulk import: resumable multipart upload straight to object storage (R2 presigned URLs,
 * the file never goes through the API), then job control. There is no size, row or daily-file limit here;
 * the only ceiling is the organisation's storage quota, which the server reports with a clear message.
 *
 *   GET  /bulk/config                      POST /bulk/uploads            GET  /bulk/uploads/:id/parts
 *   POST /bulk/uploads/:id/sign            POST /bulk/uploads/:id/complete
 *   GET  /bulk/jobs  /bulk/jobs/:id        POST /bulk/jobs/:id/{pause,resume,retry,cancel,approve}
 *   GET  /bulk/jobs/:id/tables/:idx/rows
 */
import { apiPutRaw, apiRequest } from "@/lib/api/http-client";
import { UploadHttpError, uploadResumable } from "@/lib/upload";
import type { PutPart, UploadEvent, UploadTransport } from "@/lib/upload";
import { API_PROXY_BASE_PATH, DATA_IMPORT_RESOURCE_PATH } from "@/lib/api/config";

const BASE = `${API_PROXY_BASE_PATH}/${DATA_IMPORT_RESOURCE_PATH}/bulk`;

export type BulkStatus =
  | "uploading"
  | "queued"
  | "running"
  | "pausing"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "ready"
  | "posting"
  | "posted"
  | "expired";

export interface BulkTable {
  idx: number;
  name: string;
  columns: string[];
  rows: number;
}

export interface BulkReviewTable {
  name: string;
  rowCount: number;
  detectedEntity: string | null;
  confidence: number;
  mapping: Record<string, string | null>;
  reason?: string;
  moneyUnit?: { unit: "rial" | "toman" | "unknown"; toRial: number | null };
}

export interface BulkPostProgress {
  phase: "posting" | "posted" | "failed";
  done: number;
  total: number;
  inserted: Record<string, number>;
  skipped: Record<string, number>;
  errors: string[];
}

export interface BulkJob {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: BulkStatus;
  bytesRead: number;
  rowsStaged: number;
  percent: number;
  tables: BulkTable[];
  notes: string[];
  review?: BulkReviewTable[] | null;
  postProgress: BulkPostProgress | null;
  batchId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BulkConfig {
  enabled: boolean;
  driver: "s3" | "local" | "disabled";
  direct: boolean;
  proxyParts: boolean;
  checksums: boolean;
  partBytes: number;
  quotaBytes: number;
  usedBytes: number;
  remainingBytes: number;
}

export interface BulkApproveTable {
  idx: number;
  entity: string;
  mapping: Record<string, string | null>;
  skip?: boolean;
  moneyToRial?: number;
}

export const getBulkConfig = (signal?: AbortSignal) => apiRequest<BulkConfig>(`${BASE}/config`, { signal });
export const listBulkJobs = (signal?: AbortSignal) => apiRequest<BulkJob[]>(`${BASE}/jobs`, { signal });
export const getBulkJob = (id: string, signal?: AbortSignal) =>
  apiRequest<BulkJob>(`${BASE}/jobs/${encodeURIComponent(id)}`, { signal });

const act = (id: string, verb: "pause" | "resume" | "retry" | "cancel") =>
  apiRequest<BulkJob>(`${BASE}/jobs/${encodeURIComponent(id)}/${verb}`, { method: "POST" });
export const pauseBulkJob = (id: string) => act(id, "pause");
export const resumeBulkJob = (id: string) => act(id, "resume");
export const retryBulkJob = (id: string) => act(id, "retry");
export const cancelBulkJob = (id: string) => act(id, "cancel");

export const approveBulkJob = (id: string, tables: BulkApproveTable[]) =>
  apiRequest<BulkJob>(`${BASE}/jobs/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: { tables, confirmReviewed: true },
  });

export interface BulkRows {
  columns: string[];
  rows: { rowNo: number; cells: (string | null)[] }[];
  total: number;
}
export const getBulkRows = (id: string, idx: number, after = 0, limit = 50) =>
  apiRequest<BulkRows>(`${BASE}/jobs/${encodeURIComponent(id)}/tables/${idx}/rows`, {
    searchParams: { after: String(after), limit: String(limit) },
  });

interface StartResponse {
  jobId: string;
  partBytes: number;
  totalParts: number;
  direct: boolean;
  proxyParts: boolean;
  checksums: boolean;
}
interface PartsResponse {
  partBytes: number;
  totalParts: number;
  uploaded: { partNumber: number; size: number }[];
}

export interface BulkUploadOptions {
  signal?: AbortSignal;
  /** Called with bytes uploaded so far (including parts that were already there when resuming). */
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  /** Resume an existing upload instead of starting a new one. */
  jobId?: string;
  concurrency?: number;
  onEvent?: (event: UploadEvent) => void;
}

/** PUT one part to storage with byte progress (XHR, because `fetch` cannot report upload progress). */
const putWithProgress: PutPart = (url, body, headers, onBytes, signal) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => onBytes(event.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadHttpError(xhr.status)));
    xhr.onerror = () => reject(new TypeError("network"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });

const transport: UploadTransport = {
  start: (file, signal) =>
    apiRequest<StartResponse>(`${BASE}/uploads`, { method: "POST", body: { fileName: file.name, size: file.size }, signal }),
  capabilities: async (signal) => {
    const c = await getBulkConfig(signal);
    return { direct: c.direct, proxyParts: c.proxyParts, checksums: c.checksums };
  },
  listParts: (jobId, signal) => apiRequest<PartsResponse>(`${BASE}/uploads/${jobId}/parts`, { signal }),
  sign: (jobId, partNumbers, checksums, signal) =>
    apiRequest<{ urls: Record<string, string>; headers?: Record<string, Record<string, string>> }>(`${BASE}/uploads/${jobId}/sign`, {
      method: "POST",
      body: { partNumbers, checksums },
      signal,
    }),
  putViaApi: async (jobId, partNumber, body, headers, signal) => {
    await apiPutRaw(`${BASE}/uploads/${jobId}/parts/${partNumber}`, body, signal, headers);
  },
  complete: async (jobId, signal) => {
    await apiRequest<BulkJob>(`${BASE}/uploads/${jobId}/complete`, { method: "POST", signal });
  },
};

/**
 * Uploads `file` in parts (default 64 MiB) straight to storage, four at a time, with a per-part SHA-256 when the
 * server enables it and an automatic relay through the API if the browser cannot reach storage. Closing the tab
 * or losing the network is fine: call again with the same `jobId` and only the missing parts are sent.
 */
export function uploadBulkFile(file: File, options: BulkUploadOptions = {}): Promise<string> {
  return uploadResumable(file, transport, {
    signal: options.signal,
    resumeId: options.jobId,
    concurrency: options.concurrency,
    onProgress: options.onProgress,
    onEvent: options.onEvent,
    putPart: putWithProgress,
  });
}

export function bulkStatusLabel(status: BulkStatus): string {
  const labels: Record<BulkStatus, string> = {
    uploading: "در حال بارگذاری",
    queued: "در صف پردازش",
    running: "در حال خواندن و ذخیره",
    pausing: "در حال توقف",
    paused: "متوقف‌شده",
    cancelling: "در حال لغو",
    cancelled: "لغوشده",
    failed: "ناموفق",
    ready: "آمادهٔ بازبینی",
    posting: "در حال ثبت",
    posted: "ثبت‌شده",
    expired: "منقضی",
  };
  return labels[status];
}

export const BULK_ACTIVE: BulkStatus[] = ["uploading", "queued", "running", "pausing", "cancelling", "posting"];

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
