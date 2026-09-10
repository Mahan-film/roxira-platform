import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import "./globals.css";

const vazirmatn = Vazirmatn({
  variable: "--font-vazirmatn",
  subsets: ["arabic", "latin"],
});

export const metadata: Metadata = {
  title: "پورتال خدمات سازمانی روکسیرا",
  description:
    "محاسبه خسارت تاخیر تادیه، صدور فاکتور سازمانی و مستندات API — پورتال خدمات سازمانی روکسیرا",
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
