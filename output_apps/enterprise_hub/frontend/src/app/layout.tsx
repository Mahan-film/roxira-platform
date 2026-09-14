import type { Metadata } from "next";
import { headers } from "next/headers";
import { Vazirmatn } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";

const vazirmatn = Vazirmatn({
  variable: "--font-vazirmatn",
  subsets: ["arabic", "latin"],
});

/** تشخیص دامنه بین‌المللی انگلیسی (roxira.net) از دامنه فارسی (roxira.ir). */
async function isEnglishRequest(): Promise<boolean> {
  const headerList = await headers();
  const host = (headerList.get("host") ?? "").toLowerCase();
  return host.includes("roxira.net");
}

export async function generateMetadata(): Promise<Metadata> {
  if (await isEnglishRequest()) {
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
  const isEnglish = await isEnglishRequest();

  return (
    <html
      lang={isEnglish ? "en" : "fa"}
      dir={isEnglish ? "ltr" : "rtl"}
      className={`${vazirmatn.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-vazirmatn)]">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
