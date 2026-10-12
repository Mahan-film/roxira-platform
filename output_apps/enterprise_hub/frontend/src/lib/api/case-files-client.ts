/**
 * Case-file upload client for the Smart Judge chat.
 *
 * Flow (async, see docs/research/UPLOAD_PIPELINE_2026-10-12.md P0):
 *   1. prepareImageForUpload: images are downscaled/re-encoded to JPEG in the browser
 *      (max 2400 px, quality 0.82). That strips EXIF/GPS and converts HEIC wherever the
 *      browser can decode it.
 *   2. uploadCaseFile: POST multipart with XMLHttpRequest (upload progress). The server answers
 *      202 {id, status:"processing"} within seconds; extraction continues in the background.
 *   3. watchCaseFile: poll GET /case-files/{id}/status every ~2 s until ready or failed.
 * No secrets here: the only credential is the user's own bearer token (via authHeaders).
 */
import { authHeaders } from "@/lib/api/judge-chat-client";

export const CASE_FILES_PATH = "/api/v1/apps/judge/case-files";
export const MAX_CASE_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_CASE_FILES_PER_CHAT = 5;
export const MAX_CONCURRENT_UPLOADS = 2;
export const CASE_FILE_RETENTION_DAYS = 7;
/** The transfer may stall for at most this long (no upload progress) before it is aborted. */
export const CASE_FILE_TRANSFER_TIMEOUT_MS = 60_000;
/** After the last byte is sent the server only validates and answers 202. */
export const CASE_FILE_RESPONSE_TIMEOUT_MS = 60_000;
export const CASE_FILE_POLL_START_MS = 2_000;
export const CASE_FILE_POLL_MAX_MS = 5_000;
export const IMAGE_MAX_SIDE_PX = 2400;
export const IMAGE_JPEG_QUALITY = 0.82;
/**
 * MIME types only. Listing `.heic` (or `image/heic`) makes iOS Safari hand over the raw HEIC;
 * with a plain image list it offers the photo library / camera / files and converts to JPEG.
 */
export const CASE_FILE_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,.pdf,.docx,.txt";

export const CASE_FILE_PRIVACY_NOTICE = `فایل‌ها فقط برای تحلیل پرونده پردازش می‌شوند، برای آموزش مدل استفاده نمی‌شوند و پس از ${CASE_FILE_RETENTION_DAYS} روز حذف می‌شوند.`;

const MAX_MB_FA = Math.round(MAX_CASE_FILE_BYTES / (1024 * 1024)).toLocaleString("fa-IR");
const ALLOWED_EXT = /\.(pdf|jpe?g|png|webp|heic|heif|docx|txt)$/i;
const ALLOWED_MIME = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|text\/plain|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

export type CaseFileState = "processing" | "ready" | "failed";

export interface CaseFileAccepted {
  id: string;
  status: "processing";
  name?: string;
}

export interface CaseFileStatus {
  id: string;
  status: CaseFileState;
  pages_done: number;
  pages_total: number;
  message: string;
  retry?: boolean;
  pages?: number;
  ocr_used?: boolean;
  warnings?: string[];
}

export class CaseFileError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = "CASEFILE_ERROR") {
    super(message);
    this.name = "CaseFileError";
    this.status = status;
    this.code = code;
  }
}

/** Client-side pre-check (the server re-validates by magic bytes). Returns a Persian error or null. */
export function validateCaseFile(file: { name: string; type: string; size: number }): string | null {
  if (file.size <= 0) return "فایل خالی است.";
  if (file.size > MAX_CASE_FILE_BYTES) return `حجم فایل بیش از ${MAX_MB_FA} مگابایت است؛ لطفاً فایل کوچک‌تری انتخاب کنید.`;
  // iOS often reports HEIC with an empty MIME type, so accept on either signal.
  if (!ALLOWED_EXT.test(file.name) && !ALLOWED_MIME.test(file.type)) {
    return "نوع فایل پشتیبانی نمی‌شود. فقط PDF، تصویر (JPG/PNG/HEIC)، DOCX یا TXT بارگذاری کنید.";
  }
  return null;
}

function isImageFile(file: File): boolean {
  return /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || (!file.type && IMAGE_EXT.test(file.name));
}

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void } | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    // Browsers apply EXIF orientation to <img> by default (image-orientation: from-image).
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

/**
 * Downscale (max 2400 px) and re-encode an image to JPEG 0.82. This also drops EXIF/GPS and
 * converts HEIC when the browser can decode it. Anything we cannot decode (non-images, HEIC on
 * a browser without support) is returned untouched; the server handles it as a fallback.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (!isImageFile(file) || typeof document === "undefined") return file;
  const decoded = await decodeImage(file);
  if (!decoded || decoded.width < 1 || decoded.height < 1) return file;
  try {
    const scale = Math.min(1, IMAGE_MAX_SIDE_PX / Math.max(decoded.width, decoded.height));
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff"; // JPEG has no alpha: transparent PNGs would turn black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(decoded.source, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", IMAGE_JPEG_QUALITY));
    canvas.width = canvas.height = 0; // release the backing store (iOS memory)
    if (!blob || blob.size === 0) return file;
    const base = file.name.replace(/\.[^./\\]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    decoded.close();
  }
}

/** Persian message for an HTTP failure (bodies from Cloudflare/nginx are HTML, not JSON). */
export function messageForStatus(status: number, body: unknown): string {
  const m = body && typeof body === "object" ? (body as Record<string, unknown>).message : null;
  if (typeof m === "string" && m.trim()) return m.trim();
  if (status === 401) return "برای بارگذاری پرونده وارد شوید";
  if (status === 413) return `حجم فایل بیش از ${MAX_MB_FA} مگابایت یا تعداد صفحات بیش از حد مجاز است؛ فایل کوچک‌تری انتخاب کنید.`;
  if (status === 415) return "نوع فایل پشتیبانی نمی‌شود.";
  if (status === 429) return "تعداد درخواست‌ها زیاد است؛ چند لحظه صبر کنید و دوباره تلاش کنید.";
  if (status === 422) return "متن فایل خوانده نشد؛ تصویر واضح‌تری بگیرید یا نسخه متنی بارگذاری کنید.";
  if (status === 504 || status === 524 || status === 522 || status === 408) {
    return "پاسخ سرور دیر رسید؛ دوباره تلاش کنید. اگر تکرار شد، فایل کوچک‌تری انتخاب کنید.";
  }
  if (status >= 500) return "سرویس موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید.";
  return "بارگذاری فایل انجام نشد؛ لطفاً دوباره تلاش کنید.";
}

const NETWORK_MESSAGE = "ارتباط با سرور برقرار نشد؛ اینترنت را بررسی و دوباره تلاش کنید.";
const STALLED_MESSAGE = "ارسال فایل متوقف شد (اینترنت ضعیف است)؛ اتصال را بررسی کنید و دوباره تلاش کنید.";

function parseBody(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null; // e.g. an HTML 524 page
  }
}

/**
 * Upload one prepared file with XMLHttpRequest so the UI can show a percentage.
 * Resolves on the 202; never retries the whole file by itself (the chip offers "retry").
 */
export function uploadCaseFile(
  file: File,
  opts: {
    token: string | null | undefined;
    conversationId?: string;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  },
): Promise<CaseFileAccepted> {
  const invalid = validateCaseFile(file);
  if (invalid) return Promise.reject(new CaseFileError(invalid, 400, "CLIENT_INVALID"));
  return new Promise<CaseFileAccepted>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, file.name);
    if (opts.conversationId) form.append("conversation_id", opts.conversationId);

    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        finish(() => {
          xhr.abort();
          reject(new CaseFileError(STALLED_MESSAGE, 0, "TIMEOUT"));
        });
      }, ms);
    };
    const onAbort = () => finish(() => {
      xhr.abort();
      reject(new CaseFileError("بارگذاری لغو شد.", 0, "ABORTED"));
    });

    xhr.open("POST", CASE_FILES_PATH);
    for (const [k, v] of Object.entries(authHeaders(opts.token))) xhr.setRequestHeader(k, v);
    xhr.responseType = "text";
    xhr.upload.onprogress = (ev) => {
      arm(CASE_FILE_TRANSFER_TIMEOUT_MS); // stalled = no progress for 60 s
      if (ev.lengthComputable && ev.total > 0) opts.onProgress?.(Math.min(100, Math.round((ev.loaded / ev.total) * 100)));
    };
    xhr.upload.onload = () => {
      opts.onProgress?.(100);
      arm(CASE_FILE_RESPONSE_TIMEOUT_MS);
    };
    xhr.onerror = () => finish(() => reject(new CaseFileError(NETWORK_MESSAGE, 0, "NETWORK")));
    xhr.onabort = () => finish(() => reject(new CaseFileError("بارگذاری لغو شد.", 0, "ABORTED")));
    xhr.onload = () => finish(() => {
      const body = parseBody(xhr.responseText);
      const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
      const id = rec ? (typeof rec.id === "string" ? rec.id : typeof rec.file_id === "string" ? rec.file_id : "") : "";
      if (xhr.status >= 200 && xhr.status < 300 && id) {
        resolve({ id, status: "processing", name: typeof rec?.name === "string" ? rec.name : undefined });
        return;
      }
      const code = rec ? String(rec.code ?? "") : "";
      reject(new CaseFileError(messageForStatus(xhr.status, body), xhr.status, code || "HTTP_ERROR"));
    });

    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener("abort", onAbort);
    arm(CASE_FILE_TRANSFER_TIMEOUT_MS);
    xhr.send(form);
  });
}

export async function fetchCaseFileStatus(
  fileId: string,
  token: string | null | undefined,
  signal?: AbortSignal,
): Promise<CaseFileStatus> {
  let res: Response;
  try {
    res = await fetch(`${CASE_FILES_PATH}/${encodeURIComponent(fileId)}/status`, {
      headers: authHeaders(token),
      cache: "no-store",
      signal,
    });
  } catch {
    if (signal?.aborted) throw new CaseFileError("لغو شد.", 0, "ABORTED");
    throw new CaseFileError(NETWORK_MESSAGE, 0, "NETWORK");
  }
  const body = parseBody(await res.text().catch(() => ""));
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!res.ok || !rec || typeof rec.status !== "string") {
    const code = rec ? String(rec.code ?? "") : "";
    throw new CaseFileError(messageForStatus(res.status, body), res.status, code || "HTTP_ERROR");
  }
  return body as CaseFileStatus;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done);
  });

/**
 * Poll the status every 2 s (backing off to 5 s while nothing changes) until ready or failed.
 * Tolerates short network blips; gives up after 6 consecutive failures or on 401/404.
 */
export async function watchCaseFile(
  fileId: string,
  opts: {
    token: () => string | null | undefined;
    onUpdate: (status: CaseFileStatus) => void;
    signal?: AbortSignal;
  },
): Promise<CaseFileStatus> {
  let delay = CASE_FILE_POLL_START_MS;
  let lastKey = "";
  let failures = 0;
  for (;;) {
    if (opts.signal?.aborted) throw new CaseFileError("لغو شد.", 0, "ABORTED");
    try {
      const st = await fetchCaseFileStatus(fileId, opts.token(), opts.signal);
      failures = 0;
      opts.onUpdate(st);
      if (st.status === "ready" || st.status === "failed") return st;
      const key = `${st.pages_done}/${st.pages_total}`;
      delay = key === lastKey ? Math.min(CASE_FILE_POLL_MAX_MS, Math.round(delay * 1.5)) : CASE_FILE_POLL_START_MS;
      lastKey = key;
    } catch (err) {
      const e = err instanceof CaseFileError ? err : null;
      if (e?.code === "ABORTED") throw e;
      if (e && (e.status === 401 || e.status === 404)) throw e;
      failures += 1;
      if (failures >= 6) throw e ?? new CaseFileError(NETWORK_MESSAGE, 0, "NETWORK");
      delay = Math.min(CASE_FILE_POLL_MAX_MS, delay * 2);
    }
    await sleep(delay, opts.signal);
  }
}

/** Best-effort removal of the stored text when the user removes a chip. */
export async function deleteCaseFile(fileId: string, token: string | null | undefined): Promise<void> {
  try {
    await fetch(`${CASE_FILES_PATH}/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
  } catch {
    /* it expires on its own after the retention period */
  }
}
