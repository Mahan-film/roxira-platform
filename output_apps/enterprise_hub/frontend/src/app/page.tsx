import type { Metadata } from "next";
import Link from "next/link";
import { PortalMobileNav } from "@/components/layout/portal-mobile-nav";
import {
  ArrowLeft,
  Building2,
  Cpu,
  ExternalLink,
  Layers,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

const HOME_TITLE = "روکسیرا | زیرساخت نرم‌افزارهای سازمانی و هوش مصنوعی";
const HOME_DESCRIPTION =
  "توسعه راهکارهای سازمانی CRM، ERP، حسابداری، اتصال به سامانه مؤدیان و کارخانه نرم‌افزار هوش مصنوعی در روکسیرا. مشاهده قاضی هوشمند و پیش‌ثبت‌نام.";

export const metadata: Metadata = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  alternates: { canonical: "https://roxira.ir/" },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: "https://roxira.ir/",
    siteName: "روکسیرا",
    locale: "fa_IR",
    type: "website",
  },
};

const ENTERPRISE_MODULES = [
  {
    icon: Users,
    title: "مدیریت ارتباط با مشتری و فروش (CRM)",
    badge: "در حال توسعه",
    description: "یکپارچه‌سازی چرخه پیگیری سرنخ‌های فروش و پرونده مشتریان.",
    href: "/crm",
  },
  {
    icon: Layers,
    title: "برنامه‌ریزی منابع سازمان، حسابداری و انبار (ERP)",
    badge: "در حال توسعه",
    description:
      "مدیریت اسناد حسابداری، صدور فاکتور، کنترل موجودی انبار و فرآیندهای منابع انسانی.",
    href: "/accounting",
  },
  {
    icon: ReceiptText,
    title: "رابط ارسال صورتحساب الکترونیکی سامانه مؤدیان",
    badge: "به‌زودی",
    description:
      "آماده‌سازی، اعتبارسنجی اقلام اطلاعاتی و ارسال مستقیم صورتحساب‌های الکترونیکی به کارپوشه مالیاتی.",
    href: "/invoicing",
  },
  {
    icon: Cpu,
    title: "کارخانه نرم‌افزار هوش مصنوعی (AI Software Factory)",
    badge: "در حال توسعه",
    description: "طراحی و تولید نرم‌افزارهای سفارشی درون‌سازمانی به کمک هوش مصنوعی.",
    href: "/contact",
  },
];

const PORTAL_NAV = [
  { href: "/#ghazi", label: "قاضی هوشمند" },
  { href: "/#modules", label: "ماژول‌های سازمانی" },
  { href: "/contact", label: "پیش‌ثبت‌نام و تماس" },
];

function StatusBadge({ tone, children }: { tone: "active" | "pending"; children: React.ReactNode }) {
  const toneClass =
    tone === "active"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : "border-amber-400/30 bg-amber-400/10 text-amber-300";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${toneClass}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export default function HomePage() {
  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-black text-white shadow-lg shadow-indigo-600/30">
              R
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-bold text-white">روکسیرا</span>
              <span className="font-mono text-[10px] text-slate-500" dir="ltr">
                Roxira
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 text-sm md:flex">
            <Link
              href="/#ghazi"
              className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              قاضی هوشمند
            </Link>
            <Link
              href="/#modules"
              className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              ماژول‌های سازمانی
            </Link>
            <Link
              href="/contact"
              className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              تماس
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/contact"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
            >
              <Sparkles className="size-3.5" />
              پیش‌ثبت‌نام
            </Link>
            <PortalMobileNav links={PORTAL_NAV} />
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,rgba(99,102,241,0.14),transparent_70%)]" />
          <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 font-mono text-[11px] font-semibold text-indigo-300">
              <Building2 className="size-3.5" />
              ROXIRA
            </span>
            <h1 className="mt-6 max-w-3xl text-3xl font-black leading-tight text-white sm:text-4xl">
              نسل نوین نرم‌افزارهای یکپارچه کسب‌وکار و راهکارهای تخصصی هوش مصنوعی
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-slate-400">
              روکسیرا زیرساخت‌های نرم‌افزاری مدیریت کسب‌وکار—از حسابداری، انبارداری و CRM تا
              اتصال مستقیم به سامانه مؤدیان—را در کنار کارخانه تولید نرم‌افزار مبتنی بر هوش
              مصنوعی برای سازمان‌های ایرانی طراحی و مهندسی می‌کند.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-bold text-slate-950 transition-transform hover:-translate-y-0.5"
              >
                <Sparkles className="size-4" />
                پیش‌ثبت‌نام راهکارهای سازمانی
              </Link>
              <a
                href="https://ghazihoushmand.ir"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-xs font-bold text-slate-200 transition-colors hover:border-indigo-400/40 hover:text-white"
              >
                <ExternalLink className="size-4" />
                ورود به سامانه قاضی هوشمند
              </a>
            </div>
          </div>
        </section>

        <section id="ghazi" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.04] p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge tone="active">محصول فعال</StatusBadge>
              <h2 className="text-lg font-black text-white sm:text-xl">
                قاضی هوشمند؛ نخستین محصول عملیاتی روکسیرا در اکوسیستم هوش مصنوعی حقوقی
              </h2>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-300">
              پیش از عرضه عمومی مجموعه نرم‌افزارهای سازمانی، روکسیرا توانمندی فنی خود در پردازش
              زبان طبیعی فارسی و مهندسی پایگاه‌های دانش ساختاریافته را در قالب سامانه قاضی
              هوشمند به بهره‌برداری رسانده است تا امکان جستجوی دقیق در متون تنقیح‌شده قوانین
              ایران و دریافت مشاوره مستند به مواد قانونی فراهم گردد.
            </p>
            <a
              href="https://ghazihoushmand.ir"
              className="mt-6 inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-2.5 text-xs font-bold text-emerald-200 transition-colors hover:bg-emerald-400/20"
            >
              مشاهده و استفاده از قاضی هوشمند
              <span className="font-mono text-[10px] opacity-70" dir="ltr">
                ghazihoushmand.ir
              </span>
            </a>
          </div>
        </section>

        <section id="modules" className="border-t border-white/10 bg-white/[0.015]">
          <div className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
            <div className="flex items-center gap-2">
              <Layers className="size-4 text-indigo-300" />
              <h2 className="text-lg font-bold text-white">
                اکوسیستم یکپارچه مدیریت کسب‌وکار (در مرحله پیش‌ثبت‌نام)
              </h2>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              ماژول‌های سازمانی روکسیرا در حال توسعه هستند و از طریق پیش‌ثبت‌نام قابل دسترسی
              خواهند بود.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {ENTERPRISE_MODULES.map((module) => {
                const Icon = module.icon;
                return (
                  <div
                    key={module.title}
                    className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/40 p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-300">
                        <Icon className="size-5" />
                      </span>
                      <StatusBadge tone="pending">{module.badge}</StatusBadge>
                    </div>
                    <h3 className="text-sm font-bold text-slate-100">{module.title}</h3>
                    <p className="text-xs leading-relaxed text-slate-400">
                      {module.description}
                    </p>
                    <Link
                      href={module.href}
                      className="mt-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-300 transition-colors hover:text-indigo-200"
                    >
                      اطلاعات بیشتر
                      <ArrowLeft className="size-3.5" />
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-t border-white/10 bg-white/[0.015]">
          <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 font-mono text-[11px] font-semibold text-indigo-300">
              <Sparkles className="size-3.5" />
              PRE-REGISTRATION
            </span>
            <h2 className="mt-5 text-2xl font-black text-white sm:text-3xl">
              ثبت درخواست همکاری و رزرو نوبت بهره‌برداری آزمایشی
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              برای ورود به فهرست انتظار نسخه سازمانی و هماهنگی بهره‌برداری آزمایشی، درخواست خود
              را ثبت کنید. کارشناس روکسیرا برای هماهنگی با شما تماس می‌گیرد.
            </p>
            <div className="mt-8 flex justify-center">
              <Link
                href="/contact?source=home-pre-registration"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
              >
                پیش‌ثبت‌نام و درخواست همکاری
                <ArrowLeft className="size-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-slate-950">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-center text-[11px] text-slate-500 sm:flex-row sm:px-6 sm:text-right">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3 text-emerald-400" />
            روکسیرا — نرم‌افزارهای سازمانی و هوش مصنوعی کاربردی
          </span>
          <span className="font-mono" dir="ltr">
            © 1405 Roxira · roxira.ir
          </span>
        </div>
      </footer>
    </div>
  );
}
