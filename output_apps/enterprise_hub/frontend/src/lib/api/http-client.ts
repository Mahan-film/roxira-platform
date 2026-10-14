/**
 * کلاینت HTTP عمومی برای ارتباط تایپ‌سیف با اندپوینت‌های NestJS.
 * مطابق Rule #4 AGENTS.md (Contract-First Synchronization) هر متد این
 * فایل دقیقاً بر مبنای DTOهای تعریف‌شده در `src/types/damages.ts` کار
 * می‌کند تا خروجی/ورودی هرگز از قرارداد Swagger منحرف نشود.
 */

export interface NestValidationErrorBody {
  message: string | string[];
  error?: string;
  statusCode: number;
  /**
   * پیام خطای لایهٔ FastAPI (AI Core Layer) — مثلاً `{"detail":"Not Found"}`.
   * بدون خواندن این فیلد، خطاهای موتور پایتون به‌صورت پیام مبهم فارسی
   * («خطای ناشناخته از سرور دریافت شد.») پنهان می‌شدند.
   */
  detail?: string | string[] | { message?: string } | Array<{ msg?: string; message?: string }>;
}

/** پیام‌های پیش‌فرض فارسی بر پایهٔ کد وضعیت HTTP. */
const HTTP_STATUS_FA: Record<number, string> = {
  400: "درخواست نامعتبر است.",
  401: "نشست منقضی شده است؛ لطفاً دوباره وارد شوید.",
  403: "دسترسی به این سرویس مجاز نیست.",
  404: "سرویس درخواستی در دسترس نیست.",
  422: "داده‌های ارسالی با قرارداد سرویس سازگار نیست.",
  429: "تعداد درخواست‌ها بیش از حد مجاز است؛ چند لحظه بعد تلاش کنید.",
  500: "خطای داخلی سرور؛ لطفاً دوباره تلاش کنید.",
  502: "درگاه سرویس پاسخ نداد؛ لطفاً دوباره تلاش کنید.",
  503: "سرویس موقتاً در دسترس نیست؛ لطفاً دوباره تلاش کنید.",
  504: "پاسخی از سرور دریافت نشد؛ لطفاً دوباره تلاش کنید.",
};

/** جمع‌آوری بازگشتی پیام‌های خطا از تمام شکل‌های ممکن بدنهٔ پاسخ. */
function collectErrorMessages(value: unknown, sink: string[]): void {
  if (typeof value === "string") {
    if (value.trim()) sink.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectErrorMessages(entry, sink));
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    collectErrorMessages(record.message ?? record.msg ?? record.detail, sink);
  }
}

/** خطای یکپارچه‌شده برای تمام فراخوانی‌های API با جزئیات پاسخ سرور. */
export class ApiClientError extends Error {
  readonly statusCode: number;
  readonly details: string[];

  constructor(statusCode: number, body: Partial<NestValidationErrorBody>) {
    const collected: string[] = [];
    collectErrorMessages(body.message, collected);
    collectErrorMessages(body.detail, collected);
    collectErrorMessages(body.error, collected);

    const details = Array.from(new Set(collected));
    if (details.length === 0) {
      details.push(
        HTTP_STATUS_FA[statusCode] ?? "خطای ناشناخته از سرور دریافت شد.",
      );
    }

    super(details.join(" | "));
    this.name = "ApiClientError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  searchParams?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

/** ساخت `ApiClientError` از یک پاسخ ناموفق (مشترک بین JSON و multipart). */
async function toApiError(response: Response): Promise<ApiClientError> {
  let errorBody: Partial<NestValidationErrorBody> = {};
  try {
    errorBody = (await response.json()) as Partial<NestValidationErrorBody>;
  } catch {
    errorBody = { message: response.statusText };
  }
  return new ApiClientError(response.status, errorBody);
}

function buildUrl(path: string, searchParams?: RequestOptions["searchParams"]): string {
  const query = new URLSearchParams();

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, String(value));
      }
    }
  }

  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

/**
 * توکن دسترسی سشن ذخیره‌شده (کلید مشترک با auth-client). از آنجا که
 * بک‌اند NestJS اکنون همه مسیرها را (جز مسیرهای @Public) پشت گارد JWT
 * سراسری دارد، توکن در صورت وجود به همه درخواست‌ها پیوست می‌شود.
 */
function readStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("roxira.auth.session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { accessToken?: unknown; expiresAt?: unknown };
    if (typeof parsed.accessToken !== "string") return null;
    if (typeof parsed.expiresAt === "number" && parsed.expiresAt < Date.now()) return null;
    return parsed.accessToken;
  } catch {
    return null;
  }
}

/**
 * اجرای یک درخواست HTTP تایپ‌سیف به بک‌اند NestJS از طریق پروکسی
 * Next.js. در صورت پاسخ ناموفق، `ApiClientError` با جزئیات دقیق
 * پیام‌های اعتبارسنجی class-validator پرتاب می‌شود.
 */
export async function apiRequest<TResponse>(
  path: string,
  options: RequestOptions = {},
): Promise<TResponse> {
  const url = buildUrl(path, options.searchParams);

  const headers: Record<string, string> = {};
  if (options.body) headers["Content-Type"] = "application/json";
  const token = readStoredAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await response.json()) as TResponse;
}

/**
 * ارسال `multipart/form-data` (بارگذاری فایل) با همان منطق توکن و خطای
 * `apiRequest`. هدر Content-Type عمداً تنظیم نمی‌شود تا مرورگر boundary را
 * خودش اضافه کند.
 */
export async function apiUpload<TResponse>(
  path: string,
  formData: FormData,
  signal?: AbortSignal,
): Promise<TResponse> {
  const headers: Record<string, string> = {};
  const token = readStoredAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, {
    method: "POST",
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: formData,
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await response.json()) as TResponse;
}
