/**
 * گزارش خطاهای مرورگر به بک‌اند (POST /v1/enterprise-hub/client-errors از طریق پروکسی هم‌مبدأ).
 *
 * - فقط message، stack (حداکثر ۴ کیلوبایت)، مسیر بدون query، user agent، build و زمان ارسال می‌شود.
 *   هیچ توکن، PII یا بدنهٔ درخواستی ارسال نمی‌شود. به همین دلیل از `fetch` ساده استفاده می‌شود،
 *   نه `apiRequest` (که هدر Authorization را پیوست می‌کند).
 * - در هر بارگذاری صفحه پیام تکراری یک‌بار و حداکثر ۵ گزارش ارسال می‌شود.
 * - هیچ‌وقت استثنا پرتاب نمی‌کند.
 */

export type ClientErrorKind = "error" | "unhandledrejection" | "boundary";

export const CLIENT_ERROR_ENDPOINT = "/api/backend/enterprise-hub/client-errors";
export const MAX_REPORTS_PER_PAGE_LOAD = 5;
const MAX_MESSAGE = 500;
const MAX_STACK = 4096;

const sentMessages = new Set<string>();
let sentCount = 0;
let installed = false;

/** Only for tests. */
export function resetClientErrorReporterState(): void {
  sentMessages.clear();
  sentCount = 0;
  installed = false;
}

function describe(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return { message: reason.message || reason.name, stack: reason.stack };
  }
  if (typeof reason === "string") return { message: reason };
  try {
    return { message: JSON.stringify(reason) ?? String(reason) };
  } catch {
    return { message: String(reason) };
  }
}

export function reportClientError(kind: ClientErrorKind, reason: unknown): void {
  try {
    if (typeof window === "undefined") return;
    if (sentCount >= MAX_REPORTS_PER_PAGE_LOAD) return;

    const { message, stack } = describe(reason);
    const trimmed = (message || "unknown error").slice(0, MAX_MESSAGE);
    if (sentMessages.has(trimmed)) return;
    sentMessages.add(trimmed);
    sentCount += 1;

    const body = JSON.stringify({
      message: trimmed,
      stack: stack ? stack.slice(0, MAX_STACK) : undefined,
      path: window.location.pathname.slice(0, 300),
      userAgent: window.navigator.userAgent.slice(0, 300),
      build: process.env.NEXT_PUBLIC_GIT_SHA || undefined,
      kind,
      timestamp: new Date().toISOString(),
    });

    void fetch(CLIENT_ERROR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
      cache: "no-store",
    }).catch(() => undefined);
  } catch {
    // never let the reporter itself break the page
  }
}

/** Registers window listeners once per page load. Returns a cleanup function. */
export function installClientErrorReporter(): () => void {
  if (typeof window === "undefined" || installed) return () => undefined;
  installed = true;

  const onError = (event: ErrorEvent) => {
    // Cross-origin "Script error." and resource-load errors carry no actionable detail.
    if (!event.error && !event.message) return;
    reportClientError("error", event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportClientError("unhandledrejection", event.reason);
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    installed = false;
  };
}
