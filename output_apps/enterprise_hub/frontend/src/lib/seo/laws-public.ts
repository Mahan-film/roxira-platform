/**
 * کلاینت سمت سرور پایگاه عمومی قوانین «قاضی هوشمند» (AI Core Layer — FastAPI).
 *
 * این کلاینت صرفاً در Server Components / Route Handlers (صفحات `laws` و
 * `sitemap.ts`) استفاده می‌شود و هرگز وارد باندل مرورگر نمی‌گردد. آدرس موتور
 * از متغیر محیطی `JUDGE_API_ORIGIN` خوانده می‌شود (نه هاردکد) تا در
 * production بدون تغییر کد تزریق گردد.
 *
 * قرارداد اندپوینت‌ها:
 *   • GET /laws-public/index                                   → فهرست قوانین
 *   • GET /laws-public/{law}                                   → یک قانون + مواد
 *   • GET /laws-public/{law}/{article}                         → یک ماده کامل
 *   • GET /laws-public/sitemap-entries?offset&limit            → ورودی‌های نقشه سایت
 */

const JUDGE_API_ORIGIN = (process.env.JUDGE_API_ORIGIN ?? "http://localhost:8000").replace(/\/+$/, "");

const LAWS_PUBLIC_ENDPOINT = `${JUDGE_API_ORIGIN}/api/v1/apps/judge/laws-public`;

/** محتوای قانونی به‌ندرت تغییر می‌کند؛ بازاعتبارسنجی روزانه کافی است. */
export const LAWS_REVALIDATE_SECONDS = 86_400;

/** حداکثر تعداد ورودی در هر نقشه سایت فرزند. */
export const LAWS_PER_SITEMAP = 5000;

export interface PublicLawSummary {
  slug: string;
  name: string;
  law_type: string | null;
  articles_count: number;
  approval_date: string | null;
}

export interface PublicArticleSummary {
  slug: string;
  label: string;
  status: string | null;
  is_active: boolean;
}

export interface PublicLawDetail {
  slug: string;
  name: string;
  law_type: string | null;
  approval_date: string | null;
  source: string | null;
  source_url: string | null;
  articles: PublicArticleSummary[];
}

export interface PublicArticle {
  slug: string;
  label: string;
  text: string;
  status: string | null;
  is_active: boolean;
  approval_date: string | null;
  amended_on: string | null;
  needs_review: boolean;
  source: string | null;
  source_url: string | null;
}

export interface PublicArticleDetail {
  law: { slug: string; name: string };
  article: PublicArticle;
  prev_slug: string | null;
  next_slug: string | null;
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
      next: { revalidate: LAWS_REVALIDATE_SECONDS },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** فهرست کامل قوانین فعال؛ در صورت خطا آرایه خالی برمی‌گردد. */
export async function listPublicLaws(): Promise<PublicLawSummary[]> {
  const payload = await fetchJson<PublicLawSummary[]>(`${LAWS_PUBLIC_ENDPOINT}/index`);
  return Array.isArray(payload) ? payload : [];
}

/** جزئیات یک قانون به‌همراه فهرست مواد آن؛ در صورت نبود سند `null`. */
export async function getPublicLaw(law: string): Promise<PublicLawDetail | null> {
  const slug = law.trim();
  if (!slug) return null;
  return fetchJson<PublicLawDetail>(`${LAWS_PUBLIC_ENDPOINT}/${encodeURIComponent(slug)}`);
}

/** متن کامل یک ماده به‌همراه ماده قبلی/بعدی؛ در صورت نبود سند `null`. */
export async function getPublicArticle(
  law: string,
  article: string,
): Promise<PublicArticleDetail | null> {
  const lawSlug = law.trim();
  const articleSlug = article.trim();
  if (!lawSlug || !articleSlug) return null;
  return fetchJson<PublicArticleDetail>(
    `${LAWS_PUBLIC_ENDPOINT}/${encodeURIComponent(lawSlug)}/${encodeURIComponent(articleSlug)}`,
  );
}

/** صفحه‌ای از ورودی‌های نقشه سایت قوانین. */
export async function listLawSitemapEntries(
  offset = 0,
  limit = LAWS_PER_SITEMAP,
): Promise<PublicSitemapResponse> {
  const payload = await fetchJson<PublicSitemapResponse>(
    `${LAWS_PUBLIC_ENDPOINT}/sitemap-entries?offset=${offset}&limit=${limit}`,
  );
  if (!payload || !Array.isArray(payload.entries)) {
    return { total: 0, entries: [] };
  }
  return payload;
}
