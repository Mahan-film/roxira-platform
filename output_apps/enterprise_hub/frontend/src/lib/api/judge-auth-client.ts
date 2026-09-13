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
}

/** کاربر بازگشتی از موتور قاضی. */
export interface JudgeAuthUser {
  id: string;
  phone: string;
  displayName: string | null;
  email: string | null;
  role: string;
  subscriptionTier: string;
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
  0: "ارتباط با سرور قاضی هوشمند برقرار نشد. اتصال اینترنت را بررسی و دوباره تلاش کنید.",
  400: "درخواست نامعتبر است. شماره همراه و کد تأیید را بازبینی کنید.",
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
}

/** اجرای امن یک درخواست POST JSON — هرگز استثنای خام پرتاب نمی‌کند. */
async function postJson(
  path: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<JudgePostResult> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new JudgeAuthError(0, ["درخواست لغو شد."]);
    }
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

/**
 * ارسال کد یک‌بارمصرف به شماره همراه.
 *
 * در صورت موفقیت، `status === "success"` و آمادهٔ رفتن به مرحلهٔ ورود کد است.
 * در صورت خطا، `JudgeAuthError` با پیام واقعی سرور پرتاب می‌شود.
 */
export async function sendJudgeOtp(
  rawPhone: string,
  signal?: AbortSignal,
): Promise<JudgeOtpSent> {
  const phone = normalizePhone(rawPhone);

  if (!isValidIranianMobile(phone)) {
    throw new JudgeAuthError(400, [
      "شماره همراه باید ۱۱ رقم و با قالب 09xxxxxxxxx باشد. نمونه: ۰۹۱۲۹۳۶۷۷۹۶",
    ]);
  }

  const result = await postJson(JUDGE_SEND_OTP_PATH, { phone }, signal);
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
  signal?: AbortSignal,
): Promise<JudgeAuthSession> {
  const phone = normalizePhone(rawPhone);
  const code = normalizeOtpCode(rawCode);

  if (!isValidIranianMobile(phone)) {
    throw new JudgeAuthError(400, ["شماره همراه نامعتبر است. لطفاً مرحلهٔ قبل را تکمیل کنید."]);
  }
  if (code.length < 4) {
    throw new JudgeAuthError(400, ["کد تأیید باید حداقل ۴ رقم باشد."]);
  }

  const result = await postJson(JUDGE_VERIFY_OTP_PATH, { phone, code }, signal);
  if (!result.ok) throw new JudgeAuthError(result.status, result.fallbackDetails);

  const body = result.body as Record<string, unknown>;
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
      id: asString(rawUser.id ?? rawUser.user_id) ?? phone,
      phone: asString(rawUser.phone) ?? phone,
      displayName: displayName || null,
      email: asString(rawUser.email),
      role: asString(rawUser.role) ?? "USER",
      subscriptionTier: asString(rawUser.subscription_tier ?? rawUser.subscriptionTier) ?? "FREE",
    },
  };
}
