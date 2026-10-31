import type { Metadata } from "next";
import { Clock, Mail, Phone } from "lucide-react";

import { SiteHeader } from "@/components/layout/site-header";
import { RoxiraFooter } from "@/components/layout/roxira-footer";
import { EnterpriseSalesForm } from "@/components/contact/enterprise-sales-form";

export const metadata: Metadata = {
  title: "تماس با روکسیرا",
  description:
    "ارتباط مستقیم با تیم فنی و بازرگانی روکسیرا برای راهنمایی و خرید ماژول‌های نرم‌افزار مدیریت کسب‌وکار. پشتیبانی: 09129367796.",
  alternates: { canonical: "https://roxira.ir/contact" },
  openGraph: {
    title: "تماس با روکسیرا",
    description:
      "ارتباط مستقیم با تیم فنی و بازرگانی روکسیرا برای راهنمایی و خرید ماژول‌های نرم‌افزار مدیریت کسب‌وکار. پشتیبانی: 09129367796.",
    url: "https://roxira.ir/contact",
    siteName: "روکسیرا",
    locale: "fa_IR",
    type: "website",
  },
};

interface ContactPageProps {
  searchParams?: Promise<{ source?: string | string[] }>;
}

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const params = (await searchParams) ?? {};
  const rawSource = params.source;
  const source = Array.isArray(rawSource) ? rawSource[0] : rawSource;

  return (
    <div dir="rtl" className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />

      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,rgba(99,102,241,0.14),transparent_70%)]" />
          <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h1 className="max-w-2xl text-3xl font-black leading-tight text-white sm:text-4xl">
              تماس با روکسیرا
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-slate-400">
              برای راهنمایی یا خرید ماژول‌ها، نام و شماره خود را بگذارید تا با شما تماس بگیریم. برای استفاده از نرم‌افزار نیازی به این فرم نیست؛ می‌توانید مستقیم ثبت‌نام کنید.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <EnterpriseSalesForm source={source} />
            </div>

            <aside className="space-y-6">
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
                      href="mailto:info@roxira.ir"
                      dir="ltr"
                      className="font-mono text-slate-200 transition-colors hover:text-indigo-300"
                    >
                      info@roxira.ir
                    </a>
                  </li>
                </ul>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <span className="flex items-center gap-2 text-xs font-bold text-white">
                  <Clock className="size-4" />
                  پاسخ‌گویی
                </span>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  درخواست‌ها پس از ثبت بررسی می‌شوند و کارشناس با شما تماس می‌گیرد.
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