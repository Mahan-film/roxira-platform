import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/utils";

// AI crawlers are allowed on purpose (GEO): we want to be cited. Private areas stay blocked.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/api/"] }],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
