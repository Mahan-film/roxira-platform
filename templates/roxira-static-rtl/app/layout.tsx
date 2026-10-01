import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";

const vazirmatn = Vazirmatn({ subsets: ["arabic"], variable: "--font-vazirmatn" });

export const metadata: Metadata = {
  title: "نمونه وب‌سایت روکسیر",
  description: "میکروسایت ایستای فارسی",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body
        className={vazirmatn.variable}
        style={{ fontFamily: "var(--font-vazirmatn), Vazirmatn, Tahoma, sans-serif" }}
      >
        {children}
      </body>
    </html>
  );
}
