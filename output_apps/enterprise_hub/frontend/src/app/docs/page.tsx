import type { Metadata } from "next";
import { BookOpen, ServerCog } from "lucide-react";

import { SiteHeader } from "@/components/layout/site-header";
import { RoxiraFooter } from "@/components/layout/roxira-footer";
import { ApiExplorer } from "@/components/docs/api-explorer";

export const metadata: Metadata = {
  title: "مستندات API | Roxira Enterprise OS",
  description:
    "مرجع تعاملی وب‌سرویس‌های سازمانی رکسایرا برای صورتحساب و انطباق مالیاتی (سامانه مودیان)، حسابداری دوطرفه و کارخانه نرم‌افزار خودمختار.",
};

export default function DocsPage() {
  return (
    <div dir="rtl" className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />

      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,rgba(99,102,241,0.14),transparent_70%)]" />
          <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 font-mono text-[11px] font-semibold text-indigo-300">
              <ServerCog className="size-3.5" />
              API REFERENCE
            </span>
            <h1 className="mt-6 max-w-2xl text-3xl font-black leading-tight text-white sm:text-4xl">
              مستندات وب‌سرویس‌های سازمانی رکسایرا
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-slate-400">
              اندپوینت‌های فعال صورتحساب و انطباق مالیاتی، حسابداری و کارخانه نرم‌افزار خودمختار
              را مرور کنید؛ نمونه درخواست/پاسخ را کپی کرده و اندپوینت‌های بدون پارامتر مسیر را
              مستقیماً آزمایش کنید.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="mb-6 flex items-center gap-2">
            <BookOpen className="size-4 text-indigo-300" />
            <h2 className="text-base font-bold text-white">مرجع تعاملی اندپوینت‌ها</h2>
          </div>
          <ApiExplorer />
        </section>
      </main>

      <RoxiraFooter />
    </div>
  );
}
