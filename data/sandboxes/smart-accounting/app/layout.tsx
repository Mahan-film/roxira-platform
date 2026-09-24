import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "smart-accounting",
  description: "\u0633\u06cc\u0633\u062a\u0645 \u062c\u0627\u0645\u0639 \u062d\u0633\u0627\u0628\u062f\u0627\u0631\u06cc \u0627\u0628\u0631\u06cc \u062f\u0648\u0637\u0631\u0641\u0647\u060c \u0645\u062f\u06cc\u0631\u06cc\u062a \u062f\u0641\u062a\u0631 \u06a9\u0644\u060c \u062b\u0628\u062a \u0641\u0627\u06a9\u062a\u0648\u0631 \u0631\u0633\u0645\u06cc \u0648 \u062a\u0631\u0627\u0632 \u0622\u0632\u0645\u0627\u06cc\u0634\u06cc",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className="h-full antialiased">
      <body className="min-h-full bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
