/**
 * کلاینت احراز هویت پیامکی موتور قاضی هوشمند (AI Core Layer — FastAPI/Python).
 *
 * ⚠️ قاعدهٔ قطعی مسیر: تمام فراخوانی‌های OTP این لایه باید «دقیقاً» به مسیر
 * زیر ارسال شوند و هیچ میان‌افزار دیگری (نظیر پروکسی NestJS یا rewriteهای
 * Next.js) اجازهٔ تغییر این مسیر را ندارد:
 *
 *   • POST /api/v1/apps/judge/auth/send-otp
 *   • POST /api/v1/apps/judge/auth/verify-otp
 *
 * این مسیر توسط nginx (location /api/v1/apps/judge/ → http://roxira_app_prod:8000)
 * مستقیماً به موتور پایتون پروکسی می‌شود؛ بنابراین:
 *   ۱) CORS منتفی است (هم‌مبدأ)،
 *   ۲) آدرس واقعی سرویس افشا نمی‌شود،
 *   ۳) هیچ وابستگی‌ای به لایه NestJS یا rewriteهای زمان‌ساخت Next.js وجود ندارد.
 *
 * قرارداد پاسخ دقیقاً منطبق بر `smartjudge_module.py` است:
 *   send-otp   → {"status":"success","message":...,"expires_in":180,
 *                 "channel":"SECURE_OTP","delivery_confirmed":bool, "dev_code"?}
 *   verify-otp → {"status":"success","token":...,"token_type":"Bearer",
 *                 "expires_in":...,"user":{...}}
 */

import type { PlanLevel } from "@/lib/plan-catalog";

import { newRequestId, reportClientError, sleep, waitUntilUsable } from "./judge-chat-client";

/** Per-attempt timeout of one auth call. */
export const AUTH_TIMEOUT_MS = 20_000;
/** Max attempts for a network-failing auth call, with these pauses between them. */
export const AUTH_MAX_ATTEMPTS = 3;
const AUTH_BACKOFF_MS = [1000, 3000];

/** مسیر قطعی و تنها مسیر مجاز برای ارسال کد یک‌بارمصرف. */
export const JUDGE_SEND_OTP_PATH = "/api/v1/apps/judge/auth/send-otp";

/** مسیر قطعی و تنها مسیر مجاز برای تأیید کد یک‌بارمصرف. */
export const JUDGE_VERIFY_OTP_PATH = "/api/v1/apps/judge/auth/verify-otp";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** نویسه‌های جداکننده/نامرئی که باید از شماره همراه حذف شوند. */
const SEPARATORS_RE = /[\s\-()._\u200c\u200e\u200f\u00a0]/g;

/**
 * نرمال‌سازی شماره همراه ورودی کاربر به قالب استاندارد `09xxxxxxxxx`.
 *
 * پوشش داده‌شده: ارقام فارسی (۰-۹)، ارقام عربی (٠-٩)، فاصله، خط تیره،
 * پرانتز، نقطه، نیم‌فاصله، پیشوندهای +98 / 0098 / 98 و ورودی ۱۰ رقمی
 * بدون صفر ابتدایی (9xxxxxxxxx).
 */
export function normalizePhone(raw: string | null | undefined): string {
  let out = "";
  for (const char of String(raw ?? "")) {
    const fa = PERSIAN_DIGITS.indexOf(char);
    if (fa > -1) {
      out += String(fa);
      continue;
    }
    const ar = ARABIC_DIGITS.indexOf(char);
    if (ar > -1) {
      out += String(ar);
      continue;
    }
    out += char;
  }

  out = out.replace(SEPARATORS_RE, "");

  if (out.startsWith("+")) out = out.slice(1);
  if (out.startsWith("0098")) out = `0${out.slice(4)}`;
  else if (out.startsWith("98") && out.length === 12) out = `0${out.slice(2)}`;
  else if (out.startsWith("9") && out.length === 10) out = `0${out}`;

  return out;
}

/** اعتبارسنجی قالب نهایی شماره همراه ایران (۱۱ رقم و آغاز با 09). */
export function isValidIranianMobile(phone: string): boolean {
  return /^09\d{9}$/.test(phone);
}

/** استخراج ارقام یک کد تأیید از ورودی کاربر (فارسی/عربی → ASCII). */
export function normalizeOtpCode(raw: string | null | undefined): string {
  let out = "";
  for (const char of String(raw ?? "")) {
    const fa = PERSIAN_DIGITS.indexOf(char);
    if (fa > -1) {
      out += String(fa);
      continue;
    }
    const ar = ARABIC_DIGITS.indexOf(char);
    if (ar > -1) {
      out += String(ar);
      continue;
    }
    out += char;
  }
  return out.replace(/\D/g, "");
}

/** خطای یکپارچهٔ لایهٔ احراز هویت قاضی هوشمند. */
export class JudgeAuthError extends Error {
  readonly statusCode: number;
  readonly details: string[];

  constructor(statusCode: number, details: string[]) {
    const messages = details.length > 0 ? details : ["خطای نامشخص در سرویس احراز هویت."];
    super(messages.join(" | "));
    this.name = "JudgeAuthError";
    this.statusCode = statusCode;
    this.details = messages;
  }
}

/** پاسخ اندپوینت ارسال کد. */
export interface JudgeOtpSent {
  status: string;
  message: string;
  /** اعتبار کد بر حسب ثانیه. */
  expiresIn: number;
  /** تأیید تحویل پیامک از سوی درگاه؛ false یعنی کد روی سرور صادر شده است. */
  deliveryConfirmed: boolean;
  /** کد صادرشده — تنها زمانی که درگاه پیامک در دسترس نبوده است. */
  devCode: string | null;
  /** True when a retry got 429: the first attempt had already sent the code. */
  alreadySent?: boolean;
  /** Remaining resend cooldown in seconds (from the 429 `retry_after`), if known. */
  retryAfter?: number | null;
}

/** کاربر بازگشتی از موتور قاضی. */
export interface JudgeAuthUser {
  id: string;
  phone: string;
  displayName: string | null;
  email: string | null;
  role: string;
  subscriptionTier: string;
  planLevel?: PlanLevel;
}

/** سشن صادرشده پس از تأیید موفق کد. */
export interface JudgeAuthSession {
  tokenType: string;
  accessToken: string;
  expiresIn: number;
  user: JudgeAuthUser;
}

/** پیام‌های پیش‌فرض فارسی بر پایهٔ کد وضعیت (تا هرگز پیام مبهم نمایش داده نشود). */
const STATUS_FALLBACK_MESSAGES: Record<number, string> = {
  0: "اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید یا چند لحظه بعد دوباره تلاش کنید.",
  400: "درخواست نامعتبر است. شماره همراه و کد تأیید را بازبینی کنید.",
  413: "درخواست بیش از حد بزرگ است.",
  422: "اطلاعات واردشده معتبر نیست. شماره همراه و کد تأیید را بازبینی کنید.",
  401: "نشست منقضی شده است. لطفاً دوباره وارد شوید.",
  403: "دسترسی به این سرویس مجاز نیست.",
  404: "سرویس احراز هویت در دسترس نیست. لطفاً بعداً تلاش کنید.",
  429: "تعداد تلاش‌ها بیش از حد مجاز است. چند دقیقه بعد دوباره تلاش کنید.",
  500: "خطای داخلی سرور قاضی هوشمند. لطفاً دوباره تلاش کنید.",
  502: "درگاه سرویس پاسخ نداد. لطفاً دوباره تلاش کنید.",
  503: "سرویس موقتاً در دسترس نیست. لطفاً دوباره تلاش کنید.",
  504: "پاسخی از سرور دریافت نشد. لطفاً دوباره تلاش کنید.",
};

/**
 * استخراج پیام‌های خطا از بدنهٔ پاسخ.
 *
 * بدنه‌های پشتیبانی‌شده:
 *   • FastAPI  → {"detail": "..."} یا {"detail": [{...}]}
 *   • NestJS   → {"message": string | string[], "error": ..., "statusCode": ...}
 *   • عمومی    → {"error": "..."} / {"message": {...}}
 */
function extractErrorMessages(parsed: unknown, statusCode: number): string[] {
  // FastAPI validation errors (422) are English pydantic payloads: never show them.
  if (statusCode === 422) return [STATUS_FALLBACK_MESSAGES[422]];

  const collected: string[] = [];

  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      collected.push(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      push(record.message ?? record.msg ?? record.detail ?? record.error);
    }
  };

  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    push(record.message);
    push(record.detail);
    push(record.error);
  }

  const unique = Array.from(new Set(collected));
  if (unique.length > 0) return unique;

  return [STATUS_FALLBACK_MESSAGES[statusCode] ?? "پاسخ نامعتبر از سرور قاضی هوشمند دریافت شد."];
}

interface JudgePostResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
  fallbackDetails: string[];
  retryAfter?: number | null;
  /** True when this response came from attempt 2 or later. */
  retried?: boolean;
}

export interface PostOptions {
  signal?: AbortSignal;
  /** Called before each pause when a network error forces another attempt. */
  onRetry?: (attempt: number) => void;
  /** A 429 on attempt >= 2 means attempt 1 reached the server (send-otp cooldown). */
  retry429IsSuccess?: boolean;
}

function retryAfterSeconds(response: Response, parsed: unknown): number | null {
  const candidates: unknown[] = [response.headers.get("Retry-After")];
  if (parsed && typeof parsed === "object") {
    const rec = parsed as Record<string, unknown>;
    candidates.push(rec.retry_after, rec.retryAfter);
    if (rec.detail && typeof rec.detail === "object") {
      candidates.push((rec.detail as Record<string, unknown>).retry_after);
    }
  }
  for (const c of candidates) {
    const n = Number(c);
    if (c !== null && c !== undefined && c !== "" && Number.isFinite(n) && n > 0) return Math.ceil(n);
  }
  return null;
}

/** اجرای امن یک درخواست POST JSON با تلاش مجدد روی خطای شبکه — هرگز استثنای خام پرتاب نمی‌کند. */
async function postJson(
  path: string,
  payload: Record<string, unknown>,
  opts: PostOptions = {},
): Promise<JudgePostResult> {
  const requestId = newRequestId();
  const started = Date.now();
  let response: Response | null = null;
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= AUTH_MAX_ATTEMPTS; attempt += 1) {
    attemptsUsed = attempt;
    const controller = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onCallerAbort);
    if (opts.signal?.aborted) controller.abort();
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, AUTH_TIMEOUT_MS);
    try {
      response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal,
      });
      break;
    } catch (error) {
      if (!timedOut && error instanceof DOMException && error.name === "AbortError") {
        throw new JudgeAuthError(0, ["درخواست لغو شد."]);
      }
      // Never carries phone, code, token or message text.
      reportClientError({
        kind: "network",
        message: `${path.split("/").pop()} attempt ${attempt}: ${timedOut ? "timeout" : error instanceof Error ? error.name : "Error"}`,
        request_id: requestId,
        elapsed_ms: Date.now() - started,
      });
    } finally {
      window.clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onCallerAbort);
    }
    if (attempt >= AUTH_MAX_ATTEMPTS) break;
    opts.onRetry?.(attempt);
    await waitUntilUsable(60_000);
    await sleep(AUTH_BACKOFF_MS[Math.min(attempt - 1, AUTH_BACKOFF_MS.length - 1)]);
  }
  if (!response) {
    return { ok: false, status: 0, body: null, fallbackDetails: [STATUS_FALLBACK_MESSAGES[0]] };
  }

  const raw = await response.text().catch(() => "");
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      body: null,
      fallbackDetails: extractErrorMessages(parsed, response.status),
      retryAfter: retryAfterSeconds(response, parsed),
      retried: attemptsUsed > 1,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    // پاسخ 2xx ولی بدون بدنهٔ JSON معتبر → سرویس به‌درستی پاسخ نداده است.
    throw new JudgeAuthError(response.status, [
      "پاسخ سرویس احراز هویت قابل خواندن نبود. لطفاً دوباره تلاش کنید.",
    ]);
  }

  return { ok: true, status: response.status, body: parsed as Record<string, unknown>, fallbackDetails: [] };
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asPlanLevel(value: unknown): PlanLevel | undefined {
  const level = asString(value)?.toLowerCase();
  return level === "free" || level === "basic" || level === "pro" || level === "premium" || level === "team"
    ? level
    : undefined;
}

/**
 * ارسال کد یک‌بارمصرف به شماره همراه.
 *
 * در صورت موفقیت، `status === "success"` و آمادهٔ رفتن به مرحلهٔ ورود کد است.
 * در صورت خطا، `JudgeAuthError` با پیام واقعی سرور پرتاب می‌شود.
 */
export async function sendJudgeOtp(
  rawPhone: string,
  opts: PostOptions = {},
): Promise<JudgeOtpSent> {
  const phone = normalizePhone(rawPhone);

  if (!isValidIranianMobile(phone)) {
    throw new JudgeAuthError(400, [
      "شماره همراه باید ۱۱ رقم و با قالب 09xxxxxxxxx باشد. نمونه: ۰۹۱۲۹۳۶۷۷۹۶",
    ]);
  }

  const result = await postJson(JUDGE_SEND_OTP_PATH, { phone }, opts);
  if (!result.ok && result.status === 429 && result.retried) {
    // The first attempt reached the server (60 s per-phone cooldown): the code is already sent.
    return {
      status: "success",
      message: "کد تأیید ارسال شده است.",
      expiresIn: 180,
      deliveryConfirmed: true,
      devCode: null,
      alreadySent: true,
      retryAfter: result.retryAfter ?? null,
    };
  }
  if (!result.ok) throw new JudgeAuthError(result.status, result.fallbackDetails);

  const body = result.body as Record<string, unknown>;
  const expiresIn = Number(body.expires_in ?? body.expiresIn ?? 180);

  return {
    status: asString(body.status) ?? "success",
    message: asString(body.message) ?? "کد تأیید هویت ارسال شد.",
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 180,
    deliveryConfirmed: Boolean(body.delivery_confirmed ?? body.deliveryConfirmed),
    devCode: asString(body.dev_code ?? body.devCode),
  };
}

/**
 * تأیید کد یک‌بارمصرف و دریافت توکن JWT.
 *
 * توکن صادرشده «تمیز» است و هیچ اشاره‌ای به ارائه‌دهندهٔ پیامک ندارد.
 */
export async function verifyJudgeOtp(
  rawPhone: string,
  rawCode: string,
  opts: PostOptions = {},
): Promise<JudgeAuthSession> {
  const phone = normalizePhone(rawPhone);
  const code = normalizeOtpCode(rawCode);

  if (!isValidIranianMobile(phone)) {
    throw new JudgeAuthError(400, ["شماره همراه نامعتبر است. لطفاً مرحلهٔ قبل را تکمیل کنید."]);
  }
  if (code.length < 4) {
    throw new JudgeAuthError(400, ["کد تأیید باید حداقل ۴ رقم باشد."]);
  }

  const result = await postJson(JUDGE_VERIFY_OTP_PATH, { phone, code }, opts);
  if (!result.ok) throw new JudgeAuthError(result.status, result.fallbackDetails);

  return sessionFromBody(result.body as Record<string, unknown>, phone);
}

/** Build a session from a verify-otp / email-login response body. */
function sessionFromBody(body: Record<string, unknown>, phoneFallback: string): JudgeAuthSession {
  const token = asString(body.token ?? body.access_token ?? body.accessToken);
  if (!token) {
    throw new JudgeAuthError(500, ["توکن دسترسی از سرویس دریافت نشد. لطفاً دوباره تلاش کنید."]);
  }

  const rawUser = (body.user && typeof body.user === "object" ? body.user : {}) as Record<string, unknown>;
  const displayName = [asString(rawUser.first_name), asString(rawUser.last_name)]
    .filter(Boolean)
    .join(" ");

  const expiresInRaw = Number(body.expires_in ?? body.expiresIn ?? 0);

  return {
    tokenType: asString(body.token_type ?? body.tokenType) ?? "Bearer",
    accessToken: token,
    expiresIn: Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? expiresInRaw : 60 * 60 * 24 * 30,
    user: {
      id: asString(rawUser.id ?? rawUser.user_id) ?? phoneFallback,
      phone: asString(rawUser.phone) ?? phoneFallback,
      displayName: displayName || null,
      email: asString(rawUser.email),
      role: asString(rawUser.role) ?? "USER",
      subscriptionTier: asString(rawUser.subscription_tier ?? rawUser.subscriptionTier) ?? "FREE",
      planLevel: asPlanLevel(rawUser.plan_level ?? rawUser.planLevel),
    },
  };
}

// ---------------------------------------------------------------------------
// E-mail + password accounts (for users without an Iranian SIM)
//   GET  /api/v1/apps/judge/auth/methods
//   POST /api/v1/apps/judge/auth/email/{register,verify-email,resend-verification,
//        login,forgot-password,reset-password}
// ---------------------------------------------------------------------------
const JUDGE_AUTH_BASE = "/api/v1/apps/judge/auth";

/** Which sign-in methods the server has enabled (e-mail needs SMTP configured). */
export async function fetchAuthMethods(): Promise<{ phone: boolean; email: boolean }> {
  try {
    const response = await fetch(`${JUDGE_AUTH_BASE}/methods`, { cache: "no-store" });
    if (!response.ok) return { phone: true, email: false };
    const body = (await response.json()) as Record<string, unknown>;
    return { phone: body.phone !== false, email: body.email === true };
  } catch {
    return { phone: true, email: false };
  }
}

async function emailPost(path: string, payload: Record<string, unknown>, opts: PostOptions = {}) {
  const result = await postJson(`${JUDGE_AUTH_BASE}/email/${path}`, payload, opts);
  if (!result.ok) throw new JudgeAuthError(result.status, result.fallbackDetails);
  const body = result.body as Record<string, unknown>;
  return { body, message: asString(body.message) ?? "" };
}

export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function registerWithEmail(
  email: string,
  password: string,
  phone: string | null,
  opts: PostOptions = {},
): Promise<string> {
  const normalizedPhone = phone ? normalizePhone(phone) : "";
  const payload: Record<string, unknown> = { email: email.trim(), password };
  if (normalizedPhone) payload.phone = normalizedPhone;
  return (await emailPost("register", payload, opts)).message;
}

export async function resendVerificationEmail(email: string, opts: PostOptions = {}): Promise<string> {
  return (await emailPost("resend-verification", { email: email.trim() }, opts)).message;
}

export async function loginWithEmail(
  email: string,
  password: string,
  opts: PostOptions = {},
): Promise<JudgeAuthSession> {
  const { body } = await emailPost("login", { email: email.trim(), password }, opts);
  return sessionFromBody(body, "");
}

export async function requestPasswordReset(email: string, opts: PostOptions = {}): Promise<string> {
  return (await emailPost("forgot-password", { email: email.trim() }, opts)).message;
}

export async function verifyEmailToken(token: string, opts: PostOptions = {}): Promise<string> {
  return (await emailPost("verify-email", { token }, opts)).message;
}

export async function resetPasswordWithToken(
  token: string,
  password: string,
  opts: PostOptions = {},
): Promise<string> {
  return (await emailPost("reset-password", { token, password }, opts)).message;
}
