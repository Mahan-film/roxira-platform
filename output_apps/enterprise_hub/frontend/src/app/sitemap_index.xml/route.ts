import { headers } from "next/headers";

import { SITE_ORIGINS, resolveSeoDomain } from "@/lib/seo/site-domains";
import { LAWS_PER_SITEMAP, listLawSitemapEntries } from "@/lib/seo/laws-public";

export const revalidate = 86400;

/** Sitemap index: Next.js `generateSitemaps` serves only /sitemap/{id}.xml, so list the chunks here. */
export async function GET(): Promise<Response> {
  const headerList = await headers();
  const domain = resolveSeoDomain(headerList.get("host"));
  const origin = SITE_ORIGINS[domain];
  let chunks = 1;
  if (domain === "ghazihoushmand.ir") {
    const { total } = await listLawSitemapEntries(0, 1);
    chunks = Math.max(1, Math.ceil(total / LAWS_PER_SITEMAP));
  }
  const now = new Date().toISOString();
  const items = Array.from(
    { length: chunks },
    (_, id) => `  <sitemap><loc>${origin}/sitemap/${id}.xml</loc><lastmod>${now}</lastmod></sitemap>`,
  ).join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
