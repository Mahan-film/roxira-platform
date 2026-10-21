/**
 * Helpers shared by the Smart Judge chat surfaces (text chat, STT, live voice).
 *
 * Contract: the server derives phone / tier / VIP status from the Bearer token
 * (issued by POST /api/v1/apps/judge/auth/verify-otp) and ignores `phone`,
 * `tier` and `is_vip` in request bodies, so the client never sends them.
 */

export const JUDGE_CHAT_PATH = "/api/v1/apps/judge/chat";
export const JUDGE_TRANSCRIBE_PATH = "/api/v1/apps/judge/transcribe-audio";
export const JUDGE_CLIENT_ERRORS_PATH = "/api/v1/apps/judge/client-errors";

/** Server-side cap on a single user message. */
export const MAX_CHAT_CHARS = 6000;
/** Pasted text limit in «بررسی قرارداد» mode (matches the server cap on `contract_text`). */
export const MAX_CONTRACT_CHARS = 400_000;
/** Shortest pasted text accepted as a contract (shorter input is probably an instruction, not a contract). */
export const MIN_CONTRACT_CHARS = 200;
/** Client timeout for ONE chat attempt (the server can take 30 s+ on slow links). */
export const CHAT_TIMEOUT_MS = 90_000;
/** Total attempts for one question (same request_id each time). */
export const CHAT_MAX_ATTEMPTS = 3;
/** Pause before attempt 2 and attempt 3. */
export const RETRY_BACKOFF_MS = [1500, 4000];
/** How long a pending question stays recoverable (matches the server idempotency window). */
export const PENDING_TTL_MS = 10 * 60_000;
/** Statuses that signal a transient gateway problem and are safe to retry. */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
/** Maximum length of one voice recording. */
export const MAX_RECORDING_MS = 120_000;
/** Client timeout for ONE speech-to-text upload (server budget is 80 s, see voice_stt.py). */
export const STT_TIMEOUT_MS = 100_000;

/** True when the header map carries a Bearer token. */
export function hasAuthHeader(headers: Record<string, string> | undefined): boolean {
  return Boolean(headers && Object.keys(headers).some((k) => k.toLowerCase() === "authorization"));
}

/** Copy of `headers` without Authorization (anonymous retry after a stale-token 401). */
export function withoutAuthHeader(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() !== "authorization") out[k] = v;
  }
  return out;
}

const STREAM_FAILED_KEY = "judge_stream_failed";

/** Remember (for this tab session) that /chat/stream is unreachable, so later messages use /chat. */
export function markStreamFailed(): void {
  try {
    window.sessionStorage.setItem(STREAM_FAILED_KEY, "1");
  } catch {
    /* storage unavailable */
  }
}

export function isStreamFailed(): boolean {
  try {
    return window.sessionStorage.getItem(STREAM_FAILED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Authorization header for a stored access token (empty for anonymous users). */
export function authHeaders(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Live-voice WebSocket URL; the token travels as `?token=` (browsers cannot set WS headers). */
export function liveVoiceUrl(token: string | null | undefined): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const base = `${protocol}//${window.location.host}/api/v1/apps/judge/live-voice`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export type ChatFailureKind = "auth" | "rate" | "input" | "server" | "network" | "timeout" | "empty";

export interface ChatFailure {
  kind: ChatFailureKind;
  message: string;
  retryable: boolean;
  /** Daily free limit hit: show the upgrade card ("login" = guest, offer login first). */
  upsell?: "login" | "upgrade";
}

function serverMessage(data: unknown): string | null {
  if (data && typeof data === "object") {
    const m = (data as Record<string, unknown>).message;
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  return null;
}

/** Map an HTTP failure (or a JSON `status: "ERROR"` body) to a Persian user message. */
export function failureFromResponse(status: number, data: unknown): ChatFailure {
  const msg = serverMessage(data);
  if (status === 401) {
    return {
      kind: "auth",
      message: "نشست شما منقضی شده یا نامعتبر است. لطفاً دوباره وارد شوید.",
      retryable: false,
    };
  }
  if (status === 403 && data && typeof data === "object" && (data as Record<string, unknown>).code === "CONTRACT_REVIEW_PLAN_REQUIRED") {
    return {
      kind: "rate",
      message: msg ?? "«بررسی قرارداد» ویژهٔ اشتراک ویژه و تیمی است.",
      retryable: false,
      upsell: "upgrade",
    };
  }
  if (status === 429) {
    const body = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    if (body.code === "LOGIN_OR_UPGRADE" || body.code === "UPGRADE_REQUIRED" || body.upsell === true) {
      return {
        kind: "rate",
        message: msg ?? "سقف پرسش‌های رایگان امروز شما تمام شد.",
        retryable: false,
        upsell: body.code === "LOGIN_OR_UPGRADE" ? "login" : "upgrade",
      };
    }
    return {
      kind: "rate",
      message: msg ?? "تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً چند دقیقه بعد دوباره تلاش کنید.",
      retryable: true,
    };
  }
  if (status === 413 || status === 400 || status === 422) {
    return {
      kind: "input",
      message: msg ?? `پیام نامعتبر است یا از ${MAX_CHAT_CHARS} نویسه طولانی‌تر است.`,
      retryable: false,
    };
  }
  if (status >= 500) {
    // 503 LLM_UNAVAILABLE carries its own Persian message; show it instead of the generic one.
    const code = data && typeof data === "object" ? (data as Record<string, unknown>).code : null;
    if (code === "LLM_UNAVAILABLE" && msg) return { kind: "server", message: msg, retryable: true };
    return {
      kind: "server",
      message: "خطای داخلی سرور. لطفاً چند لحظه بعد دوباره تلاش کنید.",
      retryable: true,
    };
  }
  return {
    kind: "server",
    message: msg ?? "پاسخ نامعتبر از سرور دریافت شد. لطفاً دوباره تلاش کنید.",
    retryable: true,
  };
}

export const NETWORK_FAILURE: ChatFailure = {
  kind: "network",
  message: "ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی و دوباره تلاش کنید.",
  retryable: true,
};

export const TIMEOUT_FAILURE: ChatFailure = {
  kind: "timeout",
  message: "پاسخ‌گویی بیش از ۹۰ ثانیه طول کشید. لطفاً دوباره تلاش کنید.",
  retryable: true,
};

export const EMPTY_FAILURE: ChatFailure = {
  kind: "empty",
  message: "پاسخی از سرور دریافت نشد. لطفاً دوباره تلاش کنید.",
  retryable: true,
};

/** RFC 4122 v4 id; `crypto.randomUUID` needs a secure context, so keep a fallback. */
export function newRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------------------------- pending question ---------------------------- */

const PENDING_KEY = "judge_chat_pending";

export interface PendingQuestion {
  text: string;
  request_id: string;
  ts: number;
}

export function savePending(text: string, requestId: string): void {
  try {
    const p: PendingQuestion = { text, request_id: requestId, ts: Date.now() };
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode) */
  }
}

export function clearPending(): void {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export function loadPending(): PendingQuestion | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingQuestion> | null;
    if (
      !p ||
      typeof p.text !== "string" ||
      typeof p.request_id !== "string" ||
      typeof p.ts !== "number" ||
      Date.now() - p.ts > PENDING_TTL_MS
    ) {
      clearPending();
      return null;
    }
    return { text: p.text, request_id: p.request_id, ts: p.ts };
  } catch {
    return null;
  }
}

/* ------------------------------ error reports ----------------------------- */

function uaHint(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const os = /iPhone|iPad|iPod/i.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : "other";
  const br = /CriOS|Chrome/i.test(ua) ? "chrome" : /Safari/i.test(ua) ? "safari" : /Firefox|FxiOS/i.test(ua) ? "firefox" : "other";
  return `${os}-${br}`;
}

/** Fire-and-forget report of a failed attempt. Never carries phone, token or message text. */
export function reportClientError(info: {
  kind: string;
  message: string;
  request_id: string;
  elapsed_ms: number;
}): void {
  try {
    const body = JSON.stringify({
      kind: info.kind.slice(0, 40),
      message: info.message.slice(0, 200),
      request_id: info.request_id,
      elapsed_ms: Math.round(info.elapsed_ms),
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      visibility: typeof document !== "undefined" ? document.visibilityState : "visible",
      ua_hint: uaHint(),
    });
    const blob = new Blob([body], { type: "application/json" });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(JUDGE_CLIENT_ERRORS_PATH, blob)) return;
    }
    void fetch(JUDGE_CLIENT_ERRORS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* reporting must never break the UI */
  }
}

/* ------------------------------ retrying fetch ----------------------------- */

export interface RetryOptions {
  maxAttempts: number;
  timeoutMs: number;
  /** Also retry 502/503/504 responses (chat only; uploads retry on network errors alone). */
  retryOnGatewayStatus: boolean;
  requestId: string;
  /** Called before each pause; `attempt` is the attempt that just failed (1-based). */
  onRetry?: (attempt: number) => void;
}

export class RetryTimeoutError extends Error {
  constructor() {
    super("request timed out");
    this.name = "RetryTimeoutError";
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Resolve once the tab is visible and online again (or after a safety cap). */
export function waitUntilUsable(capMs: number): Promise<void> {
  const usable = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
  if (usable()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (!usable()) return;
      cleanup();
      resolve();
    };
    const cap = window.setTimeout(() => {
      cleanup();
      resolve();
    }, capMs);
    const cleanup = () => {
      window.clearTimeout(cap);
      document.removeEventListener("visibilitychange", done);
      window.removeEventListener("online", done);
    };
    document.addEventListener("visibilitychange", done);
    window.addEventListener("online", done);
  });
}

/**
 * fetch with automatic retries that reuse one request_id. Retries on network
 * errors (TypeError such as iOS "Load failed", per-attempt timeout) and, when
 * enabled, on 502/503/504. While the tab is hidden or offline it waits for
 * `visibilitychange` / `online` before the next attempt. Returns the final
 * Response (possibly a non-OK one) or throws the last network error.
 */
export async function fetchWithRetry(
  url: string,
  init: Omit<RequestInit, "signal">,
  opts: RetryOptions,
): Promise<Response> {
  const started = Date.now();
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs);
    let failKind = "";
    let failMsg = "";
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!(opts.retryOnGatewayStatus && RETRYABLE_STATUSES.has(res.status))) return res;
      failKind = "http";
      failMsg = `HTTP ${res.status}`;
      lastError = res;
    } catch (err) {
      const name = err instanceof Error ? err.name : "Error";
      failKind = timedOut ? "timeout" : "network";
      failMsg = timedOut ? "timeout" : `${name}: ${err instanceof Error ? err.message : ""}`;
      lastError = timedOut ? new RetryTimeoutError() : err;
    } finally {
      window.clearTimeout(timer);
    }
    reportClientError({
      kind: failKind,
      message: failMsg,
      request_id: opts.requestId,
      elapsed_ms: Date.now() - started,
    });
    if (attempt >= opts.maxAttempts) break;
    opts.onRetry?.(attempt);
    await waitUntilUsable(60_000);
    await sleep(RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]);
  }
  if (lastError instanceof Response) return lastError;
  throw lastError ?? new TypeError("Failed to fetch");
}

/* ------------------------------- voice helpers ------------------------------ */

/** Report a voice failure (kind is always prefixed `voice_`). Never carries audio or text. */
export function reportVoiceError(kind: string, message: string, requestId?: string, startedAt?: number): void {
  reportClientError({
    kind: `voice_${kind}`,
    message,
    request_id: requestId ?? newRequestId(),
    elapsed_ms: startedAt ? Date.now() - startedAt : 0,
  });
}

/** True for Safari / any iOS browser (WebKit): its MediaRecorder is happiest with audio/mp4. */
export function isAppleWebKit(ua: string): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Android|Edg|OPR|Firefox|FxiOS/i.test(ua);
}

/**
 * Best MediaRecorder container for this browser: mp4/AAC on WebKit, webm/opus on Chrome and
 * Firefox, with the other as fallback. Returns "" to let the browser choose.
 */
export function pickRecorderMimeType(isSupported: (type: string) => boolean, ua: string): string {
  const webm = ["audio/webm;codecs=opus", "audio/webm"];
  const mp4 = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/aac"];
  const ogg = ["audio/ogg;codecs=opus"];
  const order = isAppleWebKit(ua) ? [...mp4, ...webm, ...ogg] : [...webm, ...ogg, ...mp4];
  for (const type of order) {
    try {
      if (isSupported(type)) return type;
    } catch {
      /* isTypeSupported can throw on odd browsers */
    }
  }
  return "";
}

/** File extension the server maps to a decoder format for a recorded Blob type. */
export function audioExtForType(blobType: string): string {
  if (/mp4|m4a|aac/i.test(blobType)) return "m4a";
  if (/ogg|opus/i.test(blobType) && !/webm/i.test(blobType)) return "ogg";
  if (/wav/i.test(blobType)) return "wav";
  return "webm";
}

export interface MicFailure {
  kind: string;
  message: string;
}

/** Persian message + report kind for a getUserMedia / MediaRecorder failure. */
export function micFailure(err: unknown): MicFailure {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return {
      kind: "mic_denied",
      message: "دسترسی به میکروفون مسدود است. در تنظیمات مرورگر (آیکن قفل کنار آدرس) میکروفون را برای این سایت مجاز کنید و دوباره تلاش کنید.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
    return { kind: "mic_missing", message: "میکروفونی روی این دستگاه پیدا نشد." };
  }
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") {
    return {
      kind: "mic_busy",
      message: "میکروفون در اختیار برنامه دیگری است (مثلاً تماس تلفنی). آن را ببندید و دوباره تلاش کنید.",
    };
  }
  return { kind: "mic_error", message: "راه‌اندازی میکروفون ناموفق بود. صفحه را دوباره بارگذاری کنید و تلاش کنید." };
}
