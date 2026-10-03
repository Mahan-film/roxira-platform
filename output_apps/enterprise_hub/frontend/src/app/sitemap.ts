import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { SITE_ORIGINS, resolveSeoDomain, type SeoDomain } from "@/lib/seo/site-domains";

type SitemapRoute = {
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
};

/**
 * نقشه مسیرهای هر دامنه.
 *
 * مسیرها دقیقاً منطبق بر گاردهای `middleware.ts` انتخاب شده‌اند:
 *   • ghazihoushmand.ir → تجربه چت‌محور قاضی هوشمند (ریشه = /chat)
 *   • roxira.ir        → پورتال خدمات سازمانی فارسی
 *   • roxira.net       → Roxira International B2B Hub (انگلیسی)
 */
const DOMAIN_ROUTES: Record<SeoDomain, SitemapRoute[]> = {
  "roxira.ir": [
    { path: "/", changeFrequency: "daily", priority: 1.0 },
    { path: "/invoicing", changeFrequency: "weekly", priority: 0.9 },
    { path: "/damages", changeFrequency: "weekly", priority: 0.9 },
    { path: "/accounting", changeFrequency: "weekly", priority: 0.8 },
    { path: "/inventory", changeFrequency: "weekly", priority: 0.8 },
    { path: "/crm", changeFrequency: "weekly", priority: 0.7 },
    { path: "/hr", changeFrequency: "monthly", priority: 0.6 },
    { path: "/coverage", changeFrequency: "weekly", priority: 0.6 },
  ],
  "roxira.net": [
    { path: "/", changeFrequency: "daily", priority: 1.0 },
    { path: "/en", changeFrequency: "daily", priority: 0.95 },
    { path: "/invoicing", changeFrequency: "weekly", priority: 0.8 },
    { path: "/accounting", changeFrequency: "weekly", priority: 0.8 },
    { path: "/inventory", changeFrequency: "weekly", priority: 0.7 },
    { path: "/crm", changeFrequency: "weekly", priority: 0.7 },
    { path: "/damages", changeFrequency: "weekly", priority: 0.7 },
    { path: "/hr", changeFrequency: "monthly", priority: 0.6 },
  ],
  "ghazihoushmand.ir": [
    { path: "/", changeFrequency: "daily", priority: 1.0 },
    { path: "/chat", changeFrequency: "daily", priority: 0.9 },
    { path: "/services", changeFrequency: "weekly", priority: 0.8 },
    { path: "/about", changeFrequency: "monthly", priority: 0.7 },
    { path: "/technology", changeFrequency: "monthly", priority: 0.7 },
    { path: "/coverage", changeFrequency: "weekly", priority: 0.6 },
    { path: "/contact", changeFrequency: "monthly", priority: 0.6 },
    { path: "/terms", changeFrequency: "yearly", priority: 0.4 },
    { path: "/privacy", changeFrequency: "yearly", priority: 0.4 },
  ],
};

/**
 * تولید نقشه سایت داینامیک بر پایه Hostname درخواست.
 *
 * استفاده از `headers()` این Route را وادار به رندر داینامیک می‌کند؛ بنابراین
 * هر دامنه فقط URLهای متعلق به خود را اعلام می‌کند و `sitemap.xml` روی
 * CDN/پراکسی بدون کش‌شدن نسخه دامنه دیگر سرو می‌شود.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const headerList = await headers();
  const domain = resolveSeoDomain(headerList.get("host"));
  const origin = SITE_ORIGINS[domain];
  const lastModified = new Date();

  return DOMAIN_ROUTES[domain].map((route) => ({
    url: `${origin}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
