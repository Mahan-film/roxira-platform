import { SITE_ORIGINS } from "@/lib/seo/site-domains";

/**
 * مبدأ متعارف (Canonical Origin) صفحات پایگاه دانش حقوقی.
 *
 * صفحات `laws/[slug]` و `precedents/[slug]` متعلق به دامنه اختصاصی
 * `ghazihoushmand.ir` هستند و URLهای آن‌ها در
 * `public/sitemap_comprehensive.xml` نیز با همین دامنه اعلام شده‌اند.
 * تثبیت مبدأ canonical روی این دامنه از ایجاد محتوای تکراری (Duplicate
 * Content) هنگام دسترسی از دامنه‌های دیگر جلوگیری می‌کند.
 */
export const LEGAL_SITE_ORIGIN: string = SITE_ORIGINS["ghazihoushmand.ir"];

/** ساخت URL مطلق و متعارف یک مسیر حقوقی. */
export function buildLegalUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${LEGAL_SITE_ORIGIN}${normalizedPath}`;
}
