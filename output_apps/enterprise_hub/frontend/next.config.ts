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
 * آدرس واقعی موتور قاضی هوشمند (AI Core Layer — FastAPI/Python).
 * در production سرویس `roxira_app_prod` روی پورت ۸۰۰۰ گوش می‌دهد.
 */
const JUDGE_API_ORIGIN = process.env.JUDGE_API_ORIGIN ?? "http://localhost:8000";

/**
 * پیشوند نسخه‌بندی global که در `main.ts` با
 * `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`
 * فعال شده است.
 */
const NEST_API_VERSION_PREFIX = "v1";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
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

  // دامنه‌های تصویر مجاز (نماد اعتماد الکترونیکی). در عمل از <img> ساده
  // استفاده می‌شود، اما این تنظیم مانع بلاک‌شدن دامنه توسط next/image است.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "trustseal.enamad.ir",
      },
    ],
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
      {
        // موتور قاضی هوشمند (AI Core Layer) روی پیشوند کامل
        // `/api/v1/apps/judge` سرو می‌شود؛ درخواست هم‌مبدأ سمت مرورگر
        // به‌صورت سرور-به-سرور به FastAPI پروکسی می‌گردد.
        source: "/api/judge/:path*",
        destination: `${JUDGE_API_ORIGIN}/api/v1/apps/judge/:path*`,
      },
      {
        // شبکهٔ اطمینان (safety net): در استقرار پروداکشن، nginx مسیر
        // `/api/v1/apps/judge/` را مستقیماً به `roxira_app_prod:8000`
        // پروکسی می‌کند و این rewrite هرگز اجرا نمی‌شود. اما اگر اپلیکیشن
        // Next.js مستقیم (بدون nginx) سرو شود، این قاعده تضمین می‌کند
        // مسیر قطعی `/api/v1/apps/judge/auth/send-otp` همچنان کار کند.
        // نکته: URL سمت مرورگر تغییر نمی‌کند و دقیقاً همان مسیر قطعی است.
        source: "/api/v1/apps/judge/:path*",
        destination: `${JUDGE_API_ORIGIN}/api/v1/apps/judge/:path*`,
      },
    ];
  },
};

export default nextConfig;
