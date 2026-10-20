/**
 * Client for the owner admin console API (FastAPI, /api/v1/apps/judge/admin/console/*).
 *
 * Security notes:
 *  - The only credential used is the owner's own login token (the same OTP JWT every user gets). Every
 *    request is re-checked on the server: the token's phone must be in SMARTJUDGE_ADMIN_PHONES, so hiding
 *    this page is not the protection - the server answers 401/403 to anyone else.
 *  - The token lives in sessionStorage (cleared when the tab closes), never in localStorage, and is never
 *    logged. No service key, API key or secret exists in this file or anywhere in the frontend.
 *  - No endpoint accepts shell text; bodies are plain JSON validated by Pydantic (extra=forbid).
 */

export const ADMIN_BASE = "/api/v1/apps/judge/admin/console";
const TOKEN_KEY = "rx_admin_token";

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfter: number | null;

  constructor(status: number, message: string, code: string | null = null, retryAfter: number | null = null) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

/** For useSyncExternalStore: lets the page react to sign-in / sign-out without an effect. */
export function subscribeAdminToken(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function hasAdminToken(): boolean {
  return getAdminToken() !== null;
}

export function setAdminToken(token: string): void {
  window.sessionStorage.setItem(TOKEN_KEY, token);
  listeners.forEach((cb) => cb());
}

export function clearAdminToken(): void {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: nothing to clear */
  }
  listeners.forEach((cb) => cb());
}

const STATUS_FA: Record<number, string> = {
  401: "نشست منقضی شده است؛ دوباره وارد شوید.",
  403: "این حساب دسترسی مدیر ندارد.",
  404: "مورد درخواستی پیدا نشد.",
  422: "داده‌های واردشده معتبر نیست.",
  429: "تعداد درخواست‌ها زیاد است؛ کمی صبر کنید.",
  502: "سرویس بالادستی پاسخ نداد.",
  503: "سرویس موقتاً در دسترس نیست.",
};

/** Persian message from any of the error shapes the API (or a proxy in front of it) can return. */
export function errorText(body: unknown, status: number): string {
  const rec = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const detail = rec.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const m = (detail as Record<string, unknown>).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as Record<string, unknown>;
    const loc = Array.isArray(first?.loc) ? String(first.loc[first.loc.length - 1]) : "";
    return `ورودی نامعتبر${loc ? ` (${loc})` : ""}: ${String(first?.msg ?? "").slice(0, 160)}`;
  }
  if (typeof rec.message === "string" && rec.message.trim()) return rec.message;
  return STATUS_FA[status] ?? `خطای سرور (${status}).`;
}

function errorCode(body: unknown): string | null {
  const rec = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const d = rec.detail && typeof rec.detail === "object" && !Array.isArray(rec.detail) ? (rec.detail as Record<string, unknown>) : rec;
  return typeof d.code === "string" ? d.code : null;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = getAdminToken();
  if (!token) throw new AdminApiError(401, STATUS_FA[401], "NO_TOKEN");
  let response: Response;
  try {
    response = await fetch(`${ADMIN_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AdminApiError(0, "اتصال به سرور برقرار نشد.", "NETWORK");
  }
  const raw = await response.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const retry = Number(response.headers.get("Retry-After"));
    throw new AdminApiError(response.status, errorText(parsed, response.status), errorCode(parsed), Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  return parsed as T;
}

export function adminGet<T>(path: string, params?: Record<string, string | number | undefined | null>, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== "") query.set(k, String(v));
  }
  const qs = query.toString();
  return request<T>("GET", qs ? `${path}?${qs}` : path, undefined, signal);
}

export function adminPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>("POST", path, body);
}

/** Download the chat dataset (admin only). Uses fetch so the Authorization header is sent. */
export async function downloadDataset(): Promise<void> {
  const token = getAdminToken();
  if (!token) throw new AdminApiError(401, STATUS_FA[401], "NO_TOKEN");
  const response = await fetch("/api/v1/apps/judge/admin/export-dataset", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new AdminApiError(response.status, STATUS_FA[response.status] ?? "دانلود ناموفق بود.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ghazihoushmand_dataset.jsonl";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
