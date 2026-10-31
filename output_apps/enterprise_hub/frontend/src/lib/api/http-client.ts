import { getFreshAccessToken, refreshStoredSession } from "@/lib/api/session-store";

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
  /** Machine-readable error code from NestJS (e.g. SMS_DELIVERY_FAILED). */
  code?: string;
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
  /** Machine-readable server error code, when the API sends one. */
  readonly code?: string;

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
    this.code = typeof body.code === "string" ? body.code : undefined;
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
 * اجرای یک درخواست HTTP تایپ‌سیف به بک‌اند NestJS از طریق پروکسی
 * Next.js. در صورت پاسخ ناموفق، `ApiClientError` با جزئیات دقیق
 * پیام‌های اعتبارسنجی class-validator پرتاب می‌شود.
 */
export async function apiRequest<TResponse>(
  path: string,
  options: RequestOptions = {},
): Promise<TResponse> {
  const url = buildUrl(path, options.searchParams);

  const send = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (options.body) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(url, {
      method: options.method ?? "GET",
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      cache: "no-store",
    });
  };

  // Renews an expired/expiring NestJS access token first; a 401 despite a
  // token (revoked or clock skew) gets one forced renewal and one retry.
  const token = await getFreshAccessToken();
  let response = await send(token);
  if (response.status === 401 && token) {
    const renewed = await refreshStoredSession(true);
    if (renewed.status === "ok") {
      response = await send(renewed.session.accessToken);
    }
  }

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
  const token = await getFreshAccessToken();
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

/** GET a file with the same token and error handling as `apiRequest`. */
export async function apiDownload(path: string, signal?: AbortSignal): Promise<Blob> {
  const token = await getFreshAccessToken();
  const response = await fetch(path, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response.blob();
}

export interface UploadProgressOptions {
  signal?: AbortSignal;
  /** Called with the upload percentage (۰ تا ۱۰۰) while the file is sent. */
  onProgress?: (percent: number) => void;
}

/**
 * مثل `apiUpload` اما با گزارش درصد بارگذاری. چون `fetch` در مرورگر
 * رویداد پیشرفت آپلود نمی‌دهد، اینجا از `XMLHttpRequest` استفاده می‌شود.
 * هدر Content-Type عمداً تنظیم نمی‌شود تا مرورگر boundary را اضافه کند.
 */
export function apiUploadWithProgress<TResponse>(
  path: string,
  formData: FormData,
  options: UploadProgressOptions = {},
): Promise<TResponse> {
  return getFreshAccessToken().then((token) => new Promise<TResponse>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.responseType = "json";

    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && options.onProgress) {
        options.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      const status = xhr.status;
      let body: unknown = xhr.response;
      if (body === null || body === undefined) {
        try {
          body = JSON.parse(xhr.responseText) as unknown;
        } catch {
          body = {};
        }
      }
      if (status >= 200 && status < 300) {
        resolve(body as TResponse);
      } else {
        reject(
          new ApiClientError(status, (body ?? {}) as Partial<NestValidationErrorBody>),
        );
      }
    };
    xhr.onerror = () =>
      reject(new ApiClientError(0, { message: "ارتباط با سرور برقرار نشد." }));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));

    xhr.send(formData);
  }));
}

/**
 * ارسال بدنهٔ خام (octet-stream) با PUT برای بارگذاری تکه‌ای؛ همان منطق توکن و خطای `apiRequest`.
 */
export async function apiPutRaw<TResponse>(
  path: string,
  body: Blob,
  signal?: AbortSignal,
): Promise<TResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
  };
  const token = await getFreshAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, {
    method: "PUT",
    headers,
    body,
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return (await response.json()) as TResponse;
}
