/**
 * تفکیک دامنه‌ای سئو (SEO Domain Registry)
 *
 * یک اپلیکیشن Next.js مشترک، بر اساس Hostname سه تجربه کاملاً مجزا ارائه
 * می‌دهد (منطق مسیریابی در `src/middleware.ts`). فایل‌های `sitemap.ts` و
 * `robots.ts` نیز باید همین تفکیک را رعایت کنند تا برای هر دامنه فقط
 * URLهای همان دامنه اعلام شود؛ در غیر این‌صورت خزشگرها با محتوای تکراری
 * (Duplicate Content) مواجه می‌شوند.
 */

export const SITE_ORIGINS = {
  "roxira.ir": "https://roxira.ir",
  "roxira.net": "https://roxira.net",
  "ghazihoushmand.ir": "https://ghazihoushmand.ir",
} as const;

export type SeoDomain = keyof typeof SITE_ORIGINS;

const GHAZI_HOSTS = ["ghazihoushmand.ir", "www.ghazihoushmand.ir"];
const ROXIRA_IR_HOSTS = ["roxira.ir", "www.roxira.ir"];
const ROXIRA_NET_HOSTS = ["roxira.net", "www.roxira.net"];

function normalizeHost(host: string): string {
  return host.split(":")[0].trim().toLowerCase();
}

/**
 * نگاشت Hostname درخواست به دامنه سئو.
 *
 * ترتیب تشخیص با `middleware.ts` هم‌راستا است تا رفتار سئو و رفتار
 * مسیریابی کاربر هرگز از هم واگرا نشوند. میزبان ناشناخته (IP سرور یا
 * پیش‌نمایش) به پورتال فارسی سازمانی نگاشت می‌گردد.
 */
export function resolveSeoDomain(host: string | null | undefined): SeoDomain {
  const h = normalizeHost(host ?? "");
  if (GHAZI_HOSTS.includes(h) || h.includes("ghazihoushmand") || h.includes("smartjudge")) {
    return "ghazihoushmand.ir";
  }
  if (ROXIRA_NET_HOSTS.includes(h) || h.includes("roxira.net")) {
    return "roxira.net";
  }
  if (ROXIRA_IR_HOSTS.includes(h) || h.includes("roxira.ir")) {
    return "roxira.ir";
  }
  return "roxira.ir";
}
