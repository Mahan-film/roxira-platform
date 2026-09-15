import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";

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
    return {
      title: "قاضی هوشمند | دستیار تخصصی حقوقی و قضایی مبتنی بر هوش مصنوعی",
      description:
        "سامانه هوشمند تحلیل دعاوی، استخراج ادله اثبات دعوا، تنظیم لایحه اعاده دادرسی و استعلام آرای وحدت رویه دیوان عالی کشور.",
    };
  }

  if (isEnglish) {
    return {
      title: "Roxira International B2B Hub",
      description:
        "Cloud enterprise platform for cross-border invoicing, multi-currency settlement, accounting, inventory and API integration.",
    };
  }

  return {
    title: "پورتال خدمات سازمانی روکسیرا",
    description:
      "محاسبه خسارت تاخیر تادیه، صدور فاکتور سازمانی و مستندات API — پورتال خدمات سازمانی روکسیرا",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { isEnglish } = await getHostInfo();

  return (
    <html
      lang={isEnglish ? "en" : "fa"}
      dir={isEnglish ? "ltr" : "rtl"}
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col font-sans">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
