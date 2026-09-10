import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import "./globals.css";

const vazirmatn = Vazirmatn({
  variable: "--font-vazirmatn",
  subsets: ["arabic", "latin"],
});

export const metadata: Metadata = {
  title: "محاسبه‌گر خسارت تاخیر تادیه | Roxira Enterprise Hub",
  description:
    "محاسبه خسارت تاخیر تادیه بر اساس شاخص بانک مرکزی (ماده ۵۲۲ ق.آ.د.م) یا نرخ سود سالانه قراردادی - Roxira Enterprise Hub",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fa"
      dir="rtl"
      className={`${vazirmatn.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-vazirmatn)]">
        {children}
      </body>
    </html>
  );
}
