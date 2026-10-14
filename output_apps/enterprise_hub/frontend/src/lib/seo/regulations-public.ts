/**
 * کلاینت سمت سرور پایگاه عمومی بخشنامه‌ها و مقررات «قاضی هوشمند»
 * (AI Core Layer — FastAPI).
 *
 * این کلاینت صرفاً در Server Components / Route Handlers (صفحات
 * `regulations` و `sitemap.ts`) استفاده می‌شود و هرگز وارد باندل مرورگر
 * نمی‌گردد. آدرس موتور از متغیر محیطی `JUDGE_API_ORIGIN` خوانده می‌شود.
 *
 * قرارداد اندپوینت‌ها:
 *   • GET /regulations-public/index                        → مراجع و تعداد
 *   • GET /regulations-public/list?issuer&offset&limit      → فهرست مقررات
 *   • GET /regulations-public/{slug}                        → یک سند کامل
 *   • GET /regulations-public/sitemap-entries?offset&limit  → ورودی‌های نقشه سایت
 */

const JUDGE_API_ORIGIN = (process.env.JUDGE_API_ORIGIN ?? "http://localhost:8000").replace(/\/+$/, "");

const REGULATIONS_PUBLIC_ENDPOINT = `${JUDGE_API_ORIGIN}/api/v1/apps/judge/regulations-public`;

/** محتوای مقررات به‌ندرت تغییر می‌کند؛ بازاعتبارسنجی روزانه کافی است. */
export const REGULATIONS_REVALIDATE_SECONDS = 86_400;

/** حداکثر تعداد ورودی در هر نقشه سایت فرزند. */
export const REGULATIONS_PER_SITEMAP = 5000;

export interface PublicRegulationIssuer {
  issuer: string;
  count: number;
}

export interface PublicRegulationIssuersResponse {
  issuers: PublicRegulationIssuer[];
  total: number;
}

export interface PublicRegulationSummary {
  slug: string;
  title: string;
  number: string | null;
  date: string | null;
  issuer: string | null;
}

export interface PublicRegulationListResponse {
  total: number;
  items: PublicRegulationSummary[];
}

export interface PublicRegulation {
  slug: string;
  title: string;
  number: string | null;
  date: string | null;
  issuer: string | null;
  subject: string | null;
  doc_type: string | null;
  text: string;
  source: string | null;
  source_url: string | null;
  source_tier: string | null;
  needs_review: boolean;
  status: string | null;
}

export interface PublicSitemapEntry {
  path: string;
  lastmod: string | null;
}

export interface PublicSitemapResponse {
  total: number;
  entries: PublicSitemapEntry[];
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      next: { revalidate: REGULATIONS_REVALIDATE_SECONDS },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** مراجع (issuer) و تعداد مقررات هر مرجع؛ در صورت خطا مقدار خالی. */
export async function listRegulationIssuers(): Promise<PublicRegulationIssuersResponse> {
  const payload = await fetchJson<PublicRegulationIssuersResponse>(
    `${REGULATIONS_PUBLIC_ENDPOINT}/index`,
  );
  if (!payload || !Array.isArray(payload.issuers)) {
    return { issuers: [], total: 0 };
  }
  return payload;
}

/** صفحه‌ای از فهرست مقررات (با فیلتر اختیاری مرجع)؛ در صورت خطا مقدار خالی. */
export async function listPublicRegulations(
  issuer?: string,
  offset = 0,
  limit = 50,
): Promise<PublicRegulationListResponse> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (issuer?.trim()) params.set("issuer", issuer.trim());
  const payload = await fetchJson<PublicRegulationListResponse>(
    `${REGULATIONS_PUBLIC_ENDPOINT}/list?${params.toString()}`,
  );
  if (!payload || !Array.isArray(payload.items)) {
    return { total: 0, items: [] };
  }
  return payload;
}

/** جزئیات کامل یک سند مقررات؛ در صورت نبود سند `null`. */
export async function getPublicRegulation(slug: string): Promise<PublicRegulation | null> {
  const trimmed = slug.trim();
  if (!trimmed) return null;
  return fetchJson<PublicRegulation>(`${REGULATIONS_PUBLIC_ENDPOINT}/${encodeURIComponent(trimmed)}`);
}

/** صفحه‌ای از ورودی‌های نقشه سایت مقررات. */
export async function listRegulationSitemapEntries(
  offset = 0,
  limit = REGULATIONS_PER_SITEMAP,
): Promise<PublicSitemapResponse> {
  const payload = await fetchJson<PublicSitemapResponse>(
    `${REGULATIONS_PUBLIC_ENDPOINT}/sitemap-entries?offset=${offset}&limit=${limit}`,
  );
  if (!payload || !Array.isArray(payload.entries)) {
    return { total: 0, entries: [] };
  }
  return payload;
}
