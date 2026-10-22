import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app/app-shell";

export const metadata: Metadata = {
  title: "نرم‌افزار روکسیرا",
  description: "نرم‌افزار مدیریت مشتریان، منابع انسانی، انبار و حسابداری روکسیرا",
  // Logged-in area: never index or cache.
  robots: { index: false, follow: false },
};

// Always render per request; the app is behind a login and must not be cached.
export const dynamic = "force-dynamic";

export default function SuiteLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
