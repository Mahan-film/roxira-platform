import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "saas-portal-v2",
  description: "Enterprise SaaS Landing with Dark Mode",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className="h-full antialiased">
      <body className="min-h-full bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
