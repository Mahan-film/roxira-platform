import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * فونت فارسی Vazirmatn (SIL OFL) به‌صورت self-host با next/font/local؛
 * فایل وریبل (وزن ۱۰۰..۹۰۰، ساب‌ست فارسی/عربی) در app/fonts/ قرار دارد و
 * هیچ وابستگی شبکه‌ای به Google Fonts در زمان ساخت/اجرا ایجاد نمی‌کند.
 */
const vazirmatn = localFont({
  src: "./fonts/Vazirmatn-Variable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-vazirmatn",
  display: "swap",
});

export const metadata: Metadata = {
  title: "روکسیرا",
  description: "میکروسایت ایستای فارسی (راست‌به‌چپ)",
};

/**
 * پیش از رنگ‌آمیزی اولیه، کلاس تم را از حافظهٔ محلی/تنظیمات سیستم روی
 * <html> می‌گذارد تا هنگام بارگذاری صفحه پرشِ روشن/تیره (FOUC) رخ ندهد.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${vazirmatn.variable} font-sans antialiased`}>
        <ThemeProvider>
          <div className="flex min-h-screen flex-col">
            <header className="border-b border-border">
              <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
                <span className="font-semibold">روکسیرا</span>
                <ThemeToggle />
              </div>
            </header>
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
