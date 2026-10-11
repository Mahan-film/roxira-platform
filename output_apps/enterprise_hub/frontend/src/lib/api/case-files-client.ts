/**
 * Case-file upload client for the Smart Judge chat.
 *
 * Browser -> POST /api/v1/apps/judge/case-files (multipart) -> extracted text kept server-side.
 * No secrets here: the only credential is the user's own bearer token (via authHeaders).
 * Uses fetchWithRetry (network/timeout retries, waits while hidden/offline). `fetch` exposes no
 * upload-progress events, so the UI shows an indeterminate "uploading / reading" state.
 */
import {
  RetryTimeoutError,
  authHeaders,
  fetchWithRetry,
  newRequestId,
} from "@/lib/api/judge-chat-client";

export const CASE_FILES_PATH = "/api/v1/apps/judge/case-files";
export const MAX_CASE_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_CASE_FILES_PER_CHAT = 5;
export const CASE_FILE_RETENTION_DAYS = 7;
/** OCR of a 30-page scan can take a while; nginx allows 300 s. */
export const CASE_FILE_TIMEOUT_MS = 240_000;
export const CASE_FILE_ACCEPT = "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx,.txt";

export const CASE_FILE_PRIVACY_NOTICE = `فایل‌ها فقط برای تحلیل پرونده پردازش می‌شوند، برای آموزش مدل استفاده نمی‌شوند و پس از ${CASE_FILE_RETENTION_DAYS} روز حذف می‌شوند.`;

const ALLOWED_EXT = /\.(pdf|jpe?g|png|webp|heic|heif|docx|txt)$/i;
const ALLOWED_MIME = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|text\/plain|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/i;

export interface CaseFileResult {
  file_id: string;
  name: string;
  pages: number;
  chars: number;
  ocr_used: boolean;
  warnings: string[];
  retention_days?: number;
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
  if (file.size > MAX_CASE_FILE_BYTES) return "حجم فایل بیش از ۱۵ مگابایت است؛ لطفاً فایل کوچک‌تری انتخاب کنید.";
  // iOS often reports HEIC with an empty MIME type, so accept on either signal.
  if (!ALLOWED_EXT.test(file.name) && !ALLOWED_MIME.test(file.type)) {
    return "نوع فایل پشتیبانی نمی‌شود. فقط PDF، تصویر (JPG/PNG/HEIC)، DOCX یا TXT بارگذاری کنید.";
  }
  return null;
}

function messageFor(status: number, body: unknown): string {
  const m = body && typeof body === "object" ? (body as Record<string, unknown>).message : null;
  if (typeof m === "string" && m.trim()) return m.trim();
  if (status === 401) return "برای بارگذاری پرونده وارد شوید";
  if (status === 413) return "حجم فایل یا تعداد صفحات بیش از حد مجاز است.";
  if (status === 415) return "نوع فایل پشتیبانی نمی‌شود.";
  if (status === 429) return "سقف بارگذاری روزانه پر شده است؛ فردا دوباره تلاش کنید.";
  if (status === 422) return "متن فایل خوانده نشد؛ تصویر واضح‌تری بگیرید یا نسخه متنی بارگذاری کنید.";
  return "بارگذاری فایل انجام نشد؛ لطفاً دوباره تلاش کنید.";
}

export async function uploadCaseFile(
  file: File,
  opts: { token: string | null | undefined; conversationId?: string; onRetry?: () => void },
): Promise<CaseFileResult> {
  const invalid = validateCaseFile(file);
  if (invalid) throw new CaseFileError(invalid, 400, "CLIENT_INVALID");
  const form = new FormData();
  form.append("file", file, file.name);
  if (opts.conversationId) form.append("conversation_id", opts.conversationId);
  let res: Response;
  try {
    res = await fetchWithRetry(
      CASE_FILES_PATH,
      { method: "POST", headers: authHeaders(opts.token), body: form },
      {
        maxAttempts: 2,
        timeoutMs: CASE_FILE_TIMEOUT_MS,
        retryOnGatewayStatus: false,
        requestId: newRequestId(),
        onRetry: () => opts.onRetry?.(),
      },
    );
  } catch (err) {
    throw new CaseFileError(
      err instanceof RetryTimeoutError
        ? "پردازش فایل بیش از حد طول کشید؛ فایل کوچک‌تری امتحان کنید."
        : "ارتباط با سرور برقرار نشد؛ اینترنت را بررسی و دوباره تلاش کنید.",
      0,
      err instanceof RetryTimeoutError ? "TIMEOUT" : "NETWORK",
    );
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok || !body || typeof body !== "object" || typeof (body as CaseFileResult).file_id !== "string") {
    const code = body && typeof body === "object" ? String((body as Record<string, unknown>).code ?? "") : "";
    throw new CaseFileError(messageFor(res.status, body), res.status, code || "HTTP_ERROR");
  }
  return body as CaseFileResult;
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
