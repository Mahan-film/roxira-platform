import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "portal-v1",
  description: "Minimal Next.js dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className="h-full antialiased">
      <body className="min-h-full bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
