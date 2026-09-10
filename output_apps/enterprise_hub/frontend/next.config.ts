import type { NextConfig } from "next";
import path from "path";

/**
 * آدرس واقعی سرویس NestJS (Enterprise App Layer).
 * می‌توان از طریق متغیر محیطی `NEST_API_ORIGIN` مقداردهی کرد؛ در غیر
 * این‌صورت مقدار پیش‌فرض توسعه (`main.ts` -> `process.env.PORT ?? 3000`)
 * استفاده می‌شود.
 */
const NEST_API_ORIGIN = process.env.NEST_API_ORIGIN ?? "http://localhost:3000";

/**
 * پیشوند نسخه‌بندی global که در `main.ts` با
 * `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`
 * فعال شده است.
 */
const NEST_API_VERSION_PREFIX = "v1";

const nextConfig: NextConfig = {
  // خروجی مستقل (standalone) برای بیلد/اجرای پروداکشن داخل Docker؛
  // فقط فایل‌های لازم اجرای سرور Next.js را در .next/standalone کپی
  // می‌کند و نیاز به نصب کامل node_modules در ایمیج نهایی را حذف می‌کند.
  output: "standalone",

  // ریشه پروژه را صریحاً به همین پوشه (frontend) محدود می‌کند تا با
  // package-lock.json موجود در enterprise_hub/ (لایه NestJS) اشتباه
  // گرفته نشود (دو لایه مجزا طبق بند ۱ AGENTS.md).
  turbopack: {
    root: path.join(__dirname),
  },
  async rewrites() {
    return [
      {
        // درخواست‌های سمت مرورگر به مسیر هم‌مبدأ (Same-Origin) ارسال شده
        // و به‌صورت سرور-به-سرور به NestJS پروکسی می‌شوند تا هیچ مشکل
        // CORS در Client Components رخ ندهد و آدرس واقعی بک‌اند نیز در
        // کد سمت مرورگر افشا نشود.
        source: "/api/backend/:path*",
        destination: `${NEST_API_ORIGIN}/${NEST_API_VERSION_PREFIX}/:path*`,
      },
    ];
  },
};

export default nextConfig;
