import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { headers } from "next/headers";
import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";
import { JsonLd } from "@/components/seo/json-ld";
import { PwaRegister } from "@/components/pwa/pwa-register";
import { ClientErrorReporter } from "@/components/observability/client-error-reporter";
import { buildBrandJsonLd } from "@/lib/seo/laws-schema";
import { umamiScriptConfig } from "@/lib/analytics/umami";

/**
 * فونت فارسی اصلی رابط کاربری (Vazirmatn) — self-host شده (next/font/local) تا
 * بیلد و رندر به دسترسی شبکه‌ای به Google Fonts در زمان اجرا وابسته نباشد،
 * با display: swap تا از فونت سیستم به فونت فارسی بدون مسدود کردن رندر (FOIT)
 * سوییچ شود. فایل وریبل (wght 100..900، ساب‌ست عربی/فارسی) در
 * src/app/fonts/Vazirmatn-Variable.woff2 (SIL OFL) قرار دارد. متغیر CSS در
 * globals.css به‌عنوان --font-sans مصرف می‌شود.
 */
const vazirmatn = localFont({
  src: "./fonts/Vazirmatn-Variable.woff2",
  weight: "100 900",
  variable: "--font-vazirmatn",
  display: "swap",
});

/** تفکیک دامنه‌های سه‌گانه جهت سئو و استخراج متادیتا */
async function getHostInfo(): Promise<{ isEnglish: boolean; isGhazi: boolean }> {
  const headerList = await headers();
  const host = (headerList.get("host") ?? "").toLowerCase();
  const isEnglish = host.includes("roxira.net");
  const isGhazi = host.includes("ghazihoushmand") || host.includes("smartjudge") || host.startsWith("ghazi");
  return { isEnglish, isGhazi };
}

export async function generateMetadata(): Promise<Metadata> {
  const { isEnglish, isGhazi } = await getHostInfo();

  if (isGhazi) {
    const title = "قاضی هوشمند | دستیار تخصصی حقوقی و قضایی مبتنی بر هوش مصنوعی";
    const description =
      "سامانه هوشمند تحلیل دعاوی، استخراج ادله اثبات دعوا، تنظیم لایحه اعاده دادرسی و استعلام آرای وحدت رویه دیوان عالی کشور.";
    return {
      title,
      description,
      alternates: { canonical: "https://ghazihoushmand.ir/" },
      openGraph: {
        title,
        description,
        url: "https://ghazihoushmand.ir/",
        siteName: "قاضی هوشمند",
        locale: "fa_IR",
        type: "website",
      },
    };
  }

  if (isEnglish) {
    return {
      title: "Roxira International B2B Hub",
      description:
        "Modular business software: accounting, invoicing and tax, inventory, HR and CRM. Each module is bought separately.",
    };
  }

  return {
    title: "روکسیرا | نرم‌افزار ماژولار مدیریت کسب‌وکار",
    description:
      "حسابداری، صورتحساب و مالیات، انبار، منابع انسانی و CRM در یک مجموعه یکپارچه. پورتال سازمانی روکسیرا.",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { isEnglish, isGhazi } = await getHostInfo();
  // Umami tracker only when a website id is configured for this host (see lib/analytics/umami.ts).
  const umami = umamiScriptConfig(isGhazi);

  return (
    <html
      lang={isEnglish ? "en" : "fa"}
      dir={isEnglish ? "ltr" : "rtl"}
      className={`h-full antialiased ${vazirmatn.variable}`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {isGhazi ? <JsonLd id="ghazi-brand-jsonld" data={buildBrandJsonLd()} /> : null}
        {isGhazi ? <PwaRegister /> : null}
        <ClientErrorReporter />
        {umami ? (
          <Script
            src={umami.src}
            data-website-id={umami.websiteId}
            data-host-url={umami.hostUrl}
            strategy="afterInteractive"
          />
        ) : null}
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
