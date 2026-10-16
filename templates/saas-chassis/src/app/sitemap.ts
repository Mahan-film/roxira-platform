import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/utils";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const paths = ["", "/sign-in", "/sign-up", "/legal/terms", "/legal/privacy", "/legal/ai-disclosure"];
  return paths.map((p) => ({
    url: `${APP_URL}${p}`,
    lastModified: now,
    changeFrequency: p === "" ? "weekly" : "monthly",
    priority: p === "" ? 1 : 0.5,
  }));
}
