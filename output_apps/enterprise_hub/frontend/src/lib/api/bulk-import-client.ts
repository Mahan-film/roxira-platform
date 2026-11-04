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
import { ApiClientError, apiPutRaw, apiRequest } from "@/lib/api/http-client";
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
}

const PART_RETRIES = 6;

/** PUT one part with progress; resolves when the storage answers 2xx. */
function putWithProgress(url: string, body: Blob, onBytes: (n: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => onBytes(event.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/**
 * Uploads `file` in parts (default 64 MiB) straight to storage, four at a time. Closing the tab or losing
 * the network is fine: call again with the same `jobId` and only the missing parts are sent.
 */
export async function uploadBulkFile(file: File, options: BulkUploadOptions = {}): Promise<string> {
  const { signal } = options;
  let jobId = options.jobId;
  let direct = true;
  let partBytes = 0;
  let totalParts = 0;
  if (jobId) {
    const parts = await apiRequest<PartsResponse>(`${BASE}/uploads/${jobId}/parts`, { signal });
    partBytes = parts.partBytes;
    totalParts = parts.totalParts;
    direct = (await getBulkConfig(signal)).direct;
  } else {
    const started = await apiRequest<StartResponse>(`${BASE}/uploads`, {
      method: "POST",
      body: { fileName: file.name, size: file.size },
      signal,
    });
    jobId = started.jobId;
    partBytes = started.partBytes;
    totalParts = started.totalParts;
    direct = started.direct;
  }
  const have = new Set(
    (await apiRequest<PartsResponse>(`${BASE}/uploads/${jobId}/parts`, { signal })).uploaded.map((p) => p.partNumber),
  );
  const sizeOf = (n: number) => (n < totalParts ? partBytes : file.size - partBytes * (totalParts - 1));
  const inFlight = new Map<number, number>();
  let done = 0;
  for (const n of have) done += sizeOf(n);
  const report = () => {
    let live = 0;
    inFlight.forEach((v) => (live += v));
    options.onProgress?.(Math.min(file.size, done + live), file.size);
  };
  report();

  const todo: number[] = [];
  for (let n = 1; n <= totalParts; n += 1) if (!have.has(n)) todo.push(n);
  const id = jobId;

  const sendOne = async (n: number): Promise<void> => {
    const blob = file.slice((n - 1) * partBytes, (n - 1) * partBytes + sizeOf(n));
    for (let attempt = 0; ; attempt += 1) {
      try {
        inFlight.set(n, 0);
        if (direct) {
          const { urls } = await apiRequest<{ urls: Record<string, string> }>(`${BASE}/uploads/${id}/sign`, {
            method: "POST",
            body: { partNumbers: [n] },
            signal,
          });
          await putWithProgress(urls[String(n)], blob, (b) => { inFlight.set(n, b); report(); }, signal);
        } else {
          await apiPutRaw(`${BASE}/uploads/${id}/parts/${n}`, blob, signal);
        }
        inFlight.delete(n);
        done += sizeOf(n);
        report();
        return;
      } catch (error) {
        inFlight.delete(n);
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (error instanceof ApiClientError && error.statusCode >= 400 && error.statusCode < 500) throw error;
        if (attempt >= PART_RETRIES) {
          throw new ApiClientError(0, { message: "ارتباط بارها قطع شد؛ بارگذاری ناتمام ماند و از همان‌جا ادامه می‌یابد." });
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(15000, 500 * 2 ** attempt)));
      }
    }
  };

  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, todo.length)) }, async () => {
    while (next < todo.length) {
      const n = todo[next];
      next += 1;
      await sendOne(n);
    }
  });
  await Promise.all(workers);
  await apiRequest<BulkJob>(`${BASE}/uploads/${id}/complete`, { method: "POST", signal });
  return id;
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
