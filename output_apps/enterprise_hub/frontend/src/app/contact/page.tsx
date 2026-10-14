import type { Metadata } from "next";
import {
  Building2,
  Clock,
  Cpu,
  FileCheck2,
  Mail,
  MapPin,
  Phone,
  ServerCog,
} from "lucide-react";

import { SiteHeader } from "@/components/layout/site-header";
import { RoxiraFooter } from "@/components/layout/roxira-footer";
import { EnterpriseSalesForm } from "@/components/contact/enterprise-sales-form";

export const metadata: Metadata = {
  title: "دموی سازمانی و فروش | Roxira Enterprise OS",
  description:
    "درخواست دموی سازمانی و استعلام فروش رکسایرا برای انطباق مالیاتی (سامانه مودیان)، ERP و حسابداری یکپارچه و کارخانه نرم‌افزار خودمختار.",
};

const COVERAGE = [
  { icon: FileCheck2, label: "انطباق مالیاتی (سامانه مودیان)" },
  { icon: Building2, label: "ERP و حسابداری یکپارچه" },
  { icon: Cpu, label: "کارخانه نرم‌افزار خودمختار" },
];

export default function ContactPage() {
  return (
    <div dir="rtl" className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />

      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,rgba(99,102,241,0.14),transparent_70%)]" />
          <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 font-mono text-[11px] font-semibold text-indigo-300">
              <ServerCog className="size-3.5" />
              ENTERPRISE DEMO &amp; SALES
            </span>
            <h1 className="mt-6 max-w-2xl text-3xl font-black leading-tight text-white sm:text-4xl">
              درخواست دموی سازمانی و استعلام فروش
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-slate-400">
              طرح مورد نظر خود را انتخاب کنید و اطلاعات شرکت را ثبت نمایید؛ کارشناس فروش سازمانی
              رکسایرا برای هماهنگی دموی اختصاصی و ارائه پیشنهاد با شما تماس می‌گیرد.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <EnterpriseSalesForm />
            </div>

            <aside className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-sm font-bold text-white">پوشش طرح‌ها</h2>
                <ul className="mt-4 space-y-3">
                  {COVERAGE.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.label} className="flex items-start gap-2.5 text-xs text-slate-300">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300">
                          <Icon className="size-3.5" />
                        </span>
                        <span className="leading-relaxed">{item.label}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-sm font-bold text-white">تماس مستقیم</h2>
                <ul className="mt-4 space-y-3 text-xs">
                  <li className="flex items-center gap-2.5">
                    <Phone className="size-3.5 shrink-0 text-indigo-300" />
                    <a
                      href="tel:09129367796"
                      dir="ltr"
                      className="font-mono font-semibold text-slate-200 transition-colors hover:text-indigo-300"
                    >
                      0912 936 7796
                    </a>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Mail className="size-3.5 shrink-0 text-indigo-300" />
                    <a
                      href="mailto:sales@roxira.ir"
                      dir="ltr"
                      className="font-mono text-slate-200 transition-colors hover:text-indigo-300"
                    >
                      sales@roxira.ir
                    </a>
                  </li>
                  <li className="flex items-start gap-2.5 leading-relaxed text-slate-300">
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-indigo-300" />
                    <span>تهران، فرمانیه، خیابان سعیدی، بن‌بست گلریز، پلاک ۱، واحد ۵</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-3xl border border-emerald-400/25 bg-emerald-400/[0.05] p-6">
                <span className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                  <Clock className="size-4" />
                  پاسخ‌گویی
                </span>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                  درخواست‌های سازمانی پس از ثبت بررسی می‌شوند و در صورت نیاز کارشناس فروش با شما تماس می‌گیرد.
                </p>
              </div>
            </aside>
          </div>
        </section>
      </main>

      <RoxiraFooter />
    </div>
  );
}
