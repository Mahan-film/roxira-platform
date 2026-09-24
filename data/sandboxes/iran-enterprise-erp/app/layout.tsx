import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "iran-enterprise-erp",
  description: "\u0633\u0627\u0645\u0627\u0646\u0647 \u06cc\u06a9\u067e\u0627\u0631\u0686\u0647 ERP \u0633\u0627\u0632\u0645\u0627\u0646\u06cc \u0634\u0627\u0645\u0644 \u062d\u0633\u0627\u0628\u062f\u0627\u0631\u06cc \u0645\u0627\u0644\u06cc\u0627\u062a\u06cc\u060c \u062a\u0631\u0627\u0632\u0646\u0627\u0645\u0647\u060c \u0627\u0646\u0628\u0627\u0631\u062f\u0627\u0631\u06cc \u0647\u0648\u0634\u0645\u0646\u062f\u060c \u062b\u0628\u062a \u0627\u0633\u0646\u0627\u062f \u062f\u0631\u06cc\u0627\u0641\u062a\u0646\u06cc \u0648 \u0645\u062f\u06cc\u0631\u06cc\u062a \u0627\u0634\u062e\u0627\u0635",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className="h-full antialiased">
      <body className="min-h-full bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
