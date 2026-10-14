import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { SITE_ORIGINS, resolveSeoDomain, type SeoDomain } from "@/lib/seo/site-domains";
import { LAWS_PER_SITEMAP, listLawSitemapEntries } from "@/lib/seo/laws-public";

const GHAZI_DOMAIN: SeoDomain = "ghazihoushmand.ir";

/**
 * خزشگرهای قانونی (Search & Social) — دسترسی کامل به محتوای عمومی.
 * این فهرست صریحاً اعلام می‌شود تا حتی اگر یک قاعده عمومی محدودکننده
 * اضافه شد، موتورهای جست‌وجوی رسمی و پیش‌نمایش‌سازهای شبکه‌های اجتماعی
 * دچار اختلال نشوند.
 */
const LEGAL_CRAWLERS = [
  "Googlebot",
  "Googlebot-Image",
  "Googlebot-News",
  "Bingbot",
  "YandexBot",
  "DuckDuckBot",
  "Baiduspider",
  "Applebot",
  "Twitterbot",
  "facebookexternalhit",
  "LinkedInBot",
  "Slackbot",
  "TelegramBot",
  "WhatsApp",
];

/**
 * بات‌های مخرب / خزشگرهای تهاجمی و اسکرپرهای هوش مصنوعی بدون قرارداد.
 * این‌ها بار سرور را بی‌دلیل مصرف می‌کنند و محتوای اختصاصی را بازنشر
 * می‌دهند؛ به‌طور کامل مسدود می‌شوند.
 */
const MALICIOUS_BOTS = [
  "AhrefsBot",
  "SemrushBot",
  "MJ12bot",
  "DotBot",
  "Bytespider",
  "CCBot",
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "DataForSeoBot",
  "BLEXBot",
  "serpstatbot",
  "megaindex",
  "SeznamBot",
  "ZoominfoBot",
  "Omgilibot",
  "ImagesiftBot",
  "Diffbot",
];

/** مسیرهای فنی/محافظت‌شده که خزش آن‌ها هیچ ارزش سئویی ندارد. */
const TECHNICAL_DISALLOW = ["/api/", "/docs", "/enterprise-hub/", "/_next/"];

/**
 * گاردریل‌های اختصاصی هر دامنه برای جلوگیری از محتوای تکراری و اتلاف
 * بودجه خزش (Crawl Budget).
 */
const DOMAIN_DISALLOW: Record<SeoDomain, string[]> = {
  "roxira.ir": ["/chat", "/judge", "/en"],
  "roxira.net": ["/chat", "/judge"],
  "ghazihoushmand.ir": ["/en", "/invoicing", "/damages", "/accounting", "/inventory", "/crm", "/hr"],
};

/**
 * تولید `robots.txt` داینامیک بر پایه Hostname درخواست.
 *
 * برای هر دامنه، آدرس `sitemap.xml` همان دامنه اعلام می‌شود تا خزشگر هرگز
 * به نقشه سایت دامنه‌ای دیگر ارجاع داده نشود. دامنه قاضی هوشمند علاوه بر
 * `sitemap.xml` همه قطعه‌های `generateSitemaps` را نیز اعلام می‌کند.
 */
export const dynamic = "force-dynamic";

async function sitemapUrls(domain: SeoDomain, origin: string): Promise<string | string[]> {
  if (domain !== GHAZI_DOMAIN) {
    return `${origin}/sitemap_index.xml`;
  }
  const { total } = await listLawSitemapEntries(0, 1);
  const chunkCount = Math.max(1, Math.ceil(total / LAWS_PER_SITEMAP));
  return [
    `${origin}/sitemap_index.xml`,
    ...Array.from({ length: chunkCount }, (_, id) => `${origin}/sitemap/${id}.xml`),
  ];
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const headerList = await headers();
  const domain = resolveSeoDomain(headerList.get("host"));
  const origin = SITE_ORIGINS[domain];

  return {
    rules: [
      {
        userAgent: LEGAL_CRAWLERS,
        allow: "/",
        disallow: TECHNICAL_DISALLOW,
      },
      {
        userAgent: MALICIOUS_BOTS,
        disallow: "/",
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: [...TECHNICAL_DISALLOW, ...DOMAIN_DISALLOW[domain]],
      },
    ],
    sitemap: await sitemapUrls(domain, origin),
    host: origin,
  };
}
