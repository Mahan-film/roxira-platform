import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { SITE_ORIGINS, resolveSeoDomain, type SeoDomain } from "@/lib/seo/site-domains";
import {
  LAWS_PER_SITEMAP,
  listLawSitemapEntries,
  listPublicLaws,
  type PublicSitemapEntry,
} from "@/lib/seo/laws-public";
import { GUIDE_SLUGS } from "@/lib/guides";

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
    { path: "/guide", changeFrequency: "monthly", priority: 0.7 },
    { path: "/guides", changeFrequency: "weekly", priority: 0.7 },
    { path: "/about", changeFrequency: "monthly", priority: 0.7 },
    { path: "/technology", changeFrequency: "monthly", priority: 0.7 },
    { path: "/coverage", changeFrequency: "weekly", priority: 0.6 },
    { path: "/contact", changeFrequency: "monthly", priority: 0.6 },
    { path: "/terms", changeFrequency: "yearly", priority: 0.4 },
    { path: "/privacy", changeFrequency: "yearly", priority: 0.4 },
  ],
};

const GHAZI_DOMAIN: SeoDomain = "ghazihoushmand.ir";

/**
 * تولید نقشه سایت داینامیک بر پایه Hostname درخواست.
 *
 * استفاده از `headers()` این Route را وادار به رندر داینامیک می‌کند؛ بنابراین
 * هر دامنه فقط URLهای متعلق به خود را اعلام می‌کند و `sitemap.xml` روی
 * CDN/پراکسی بدون کش‌شدن نسخه دامنه دیگر سرو می‌شود.
 *
 * برای دامنه قاضی هوشمند، صفحات قوانین با `generateSitemaps` به قطعه‌های
 * ۵۰۰۰تایی (بر پایه `laws-public/sitemap-entries`) شکسته می‌شوند تا نقشه سایت
 * اصلی از سقف مجاز URL فراتر نرود. `/laws` و هر `/laws/{law}` نیز در قطعه
 * نخست افزوده می‌شوند.
 */
export const dynamic = "force-dynamic";

export async function generateSitemaps(): Promise<Array<{ id: number }>> {
  const { total } = await listLawSitemapEntries(0, 1);
  const chunkCount = Math.max(1, Math.ceil(total / LAWS_PER_SITEMAP));
  return Array.from({ length: chunkCount }, (_, id) => ({ id }));
}

function toSitemapEntry(entry: PublicSitemapEntry): MetadataRoute.Sitemap[number] {
  const origin = SITE_ORIGINS[GHAZI_DOMAIN];
  const url = entry.path.startsWith("http")
    ? entry.path
    : `${origin}${entry.path.startsWith("/") ? entry.path : `/${entry.path}`}`;
  const parsed = entry.lastmod ? new Date(entry.lastmod) : null;
  return {
    url,
    lastModified: parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined,
    changeFrequency: "monthly",
    priority: 0.5,
  };
}

export default async function sitemap(props: {
  id: Promise<string | number> | string | number;
}): Promise<MetadataRoute.Sitemap> {
  // Next.js 16 passes the generateSitemaps id as a Promise<string>.
  const id = Number(await props.id) || 0;
  const headerList = await headers();
  const domain = resolveSeoDomain(headerList.get("host"));
  const origin = SITE_ORIGINS[domain];
  const lastModified = new Date();

  const staticRoutes: MetadataRoute.Sitemap = DOMAIN_ROUTES[domain].map((route) => ({
    url: `${origin}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  if (domain !== GHAZI_DOMAIN) {
    return id === 0 ? staticRoutes : [];
  }

  if (id > 0) {
    const chunk = await listLawSitemapEntries(id * LAWS_PER_SITEMAP, LAWS_PER_SITEMAP);
    return chunk.entries.map(toSitemapEntry);
  }

  const laws = await listPublicLaws();
  const lawRoutes: MetadataRoute.Sitemap = [
    { url: `${origin}/laws`, lastModified, changeFrequency: "weekly", priority: 0.8 },
    ...laws.map((law) => ({
      url: `${origin}/laws/${encodeURIComponent(law.slug)}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
  const guideRoutes: MetadataRoute.Sitemap = GUIDE_SLUGS.map((slug) => ({
    url: `${origin}/guides/${encodeURIComponent(slug)}`,
    lastModified,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
  const firstChunk = await listLawSitemapEntries(0, LAWS_PER_SITEMAP);
  return [...staticRoutes, ...guideRoutes, ...lawRoutes, ...firstChunk.entries.map(toSitemapEntry)];
}
