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
}

/** خطای یکپارچه‌شده برای تمام فراخوانی‌های API با جزئیات پاسخ NestJS */
export class ApiClientError extends Error {
  readonly statusCode: number;
  readonly details: string[];

  constructor(statusCode: number, body: Partial<NestValidationErrorBody>) {
    const details = Array.isArray(body.message)
      ? body.message
      : body.message
        ? [body.message]
        : ["خطای ناشناخته از سرور دریافت شد."];

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

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    cache: "no-store",
  });

  if (!response.ok) {
    let errorBody: Partial<NestValidationErrorBody> = {};
    try {
      errorBody = (await response.json()) as Partial<NestValidationErrorBody>;
    } catch {
      errorBody = { message: response.statusText };
    }
    throw new ApiClientError(response.status, errorBody);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await response.json()) as TResponse;
}
