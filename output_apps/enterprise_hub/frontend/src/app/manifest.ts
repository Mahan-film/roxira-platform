import type { MetadataRoute } from "next";
import { headers } from "next/headers";

/**
 * مانیفست وب اپلیکیشن (Web App Manifest) — مسیر Next.js:
 *   app/manifest.ts → /manifest.webmanifest
 *
 * این فایل روی سه دامنهٔ مشترک سرو می‌شود؛ اما نصب‌پذیری (PWA/TWA) فقط برای
 * «قاضی هوشمند» روی ghazihoushmand.ir معنا دارد. برای سایر دامنه‌ها یک
 * مانیفست خنثی و بدون آیکون بازمی‌گردانیم تا در مرورگر به‌عنوان اپ قاضی نصب
 * نشوند (نشت برند/دامنه).
 */

const GHAZI_HOSTS = ["ghazihoushmand.ir", "www.ghazihoushmand.ir"];

function isGhaziHost(host: string): boolean {
  const h = host.split(":")[0].trim().toLowerCase();
  return (
    GHAZI_HOSTS.includes(h) ||
    h.includes("ghazihoushmand") ||
    h.includes("smartjudge") ||
    h.startsWith("ghazi")
  );
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const host = (await headers()).get("host") ?? "";

  if (!isGhaziHost(host)) {
    // دامنه‌های پورتال روکسیرا نصب‌پذیر نیستند.
    return {
      name: "Roxira",
      short_name: "Roxira",
      start_url: "/",
    };
  }

  return {
    name: "قاضی هوشمند",
    short_name: "قاضی هوشمند",
    description:
      "دستیار تخصصی حقوقی و قضایی مبتنی بر هوش مصنوعی؛ تحلیل دعاوی، استخراج ادله اثبات دعوا و تنظیم لوایح قضایی.",
    dir: "rtl",
    lang: "fa",
    start_url: "/chat?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // رنگ‌های پالت صفحهٔ فرود قاضی هوشمند: آبی پررنگ هدر (blue-900) و پس‌زمینهٔ تیرهٔ چت (slate-950).
    theme_color: "#1e3a8a",
    background_color: "#020617",
    icons: [
      {
        src: "/icons/ghazi-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/ghazi-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/ghazi-maskable.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
