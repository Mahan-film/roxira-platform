import type { Metadata } from "next";
import Link from "next/link";
import { PortalAuthActions } from "@/components/auth/portal-auth-actions";
import { EnamadBadge } from "@/components/layout/EnamadBadge";
import { PortalMobileNav } from "@/components/layout/portal-mobile-nav";
import {
  ArrowLeft,
  BookOpenCheck,
  Boxes,
  Building2,
  Contact,
  Landmark,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";

const HOME_TITLE = "روکسیرا | نرم‌افزار ماژولار حسابداری، انبار، منابع انسانی و CRM";
const HOME_DESCRIPTION =
  "مجموعه ماژولار نرم‌افزار مدیریت کسب‌وکار برای سازمان‌های ایرانی: حسابداری، صورتحساب و مالیات، انبار، منابع انسانی و CRM. هر ماژول جداگانه خریداری می‌شود.";

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

/**
 * Module status is stated as it is in the code today. All modules run in the signed-in
 * portal in a trial release; none is described as finished or as connected to an
 * external system unless it is. Prices are not shown here (owner decision).
 */
const MODULES = [
  {
    icon: BookOpenCheck,
    title: "حسابداری و دفتر کل",
    description:
      "ثبت سند دوطرفه با کنترل تراز، تراز آزمایشی، دفتر معین و ورود اطلاعات از نرم‌افزارهای قبلی.",
    href: "/accounting",
  },
  {
    icon: ReceiptText,
    title: "صورتحساب و مالیات",
    description:
      "صدور صورتحساب با محاسبه مالیات بر ارزش افزوده. اتصال به سامانه مودیان در مرحله آزمایشی است.",
    href: "/invoicing",
  },
  {
    icon: Boxes,
    title: "انبار و موجودی",
    description: "تعریف کالا و انبار، گردش موجودی و گزارش ارزش موجودی به روش FIFO.",
    href: "/inventory",
  },
  {
    icon: UsersRound,
    title: "منابع انسانی و حقوق",
    description: "پرونده کارکنان، قراردادها و محاسبه فیش حقوقی.",
    href: "/hr",
  },
  {
    icon: Contact,
    title: "مدیریت ارتباط با مشتری (CRM)",
    description: "پیگیری سرنخ‌های فروش و پرونده مشتریان روی برد کانبان.",
    href: "/crm",
  },
  {
    icon: Landmark,
    title: "تطبیق بانکی",
    description: "تطبیق گردش حساب بانکی با دفتر کل. در مرحله آزمایشی.",
    href: "/app/accounting/bank",
  },
];

const PORTAL_NAV = [
  { href: "/#modules", label: "ماژول‌ها" },
  { href: "/contact", label: "تماس" },
];

function StatusBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-bold text-amber-300">
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
            {PORTAL_NAV.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <PortalAuthActions />
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
              نرم‌افزار مدیریت کسب‌وکار
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-slate-400">
              حسابداری، صورتحساب و مالیات، انبار، منابع انسانی و CRM در یک مجموعه یکپارچه.
              داده‌ها بین بخش‌ها مشترک است و هر بخش را می‌توان جدا فعال کرد. این نرم‌افزار
              اکنون در نسخه آزمایشی است.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-bold text-slate-950 transition-transform hover:-translate-y-0.5"
              >
                <Sparkles className="size-4" />
                ثبت‌نام و شروع نسخه آزمایشی
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-xs font-bold text-slate-200 transition-colors hover:border-indigo-400/40 hover:text-white"
              >
                ورود به حساب
              </Link>
            </div>
          </div>
        </section>

                <section id="modules" className="scroll-mt-20 border-t border-white/10 bg-white/[0.015]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-lg font-bold text-white">ماژول‌های روکسیرا</h2>
            <p className="mt-2 text-xs leading-6 text-slate-400">
              هر ماژول مستقل است و با ماژول‌های دیگر داده مشترک دارد. وضعیت همه ماژول‌ها
              «نسخه آزمایشی» است و پس از ثبت‌نام می‌توانید آن‌ها را بررسی کنید.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {MODULES.map((module) => {
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
                      <StatusBadge>نسخه آزمایشی</StatusBadge>
                    </div>
                    <h3 className="text-sm font-bold text-slate-100">{module.title}</h3>
                    <p className="text-xs leading-relaxed text-slate-400">{module.description}</p>
                    <Link
                      href={module.href}
                      className="mt-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-300 transition-colors hover:text-indigo-200"
                    >
                      ورود و مشاهده ماژول
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
            <h2 className="text-2xl font-black text-white sm:text-3xl">
              سؤالی دارید؟
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              شماره خود را بگذارید تا کارشناس روکسیرا برای راهنمایی و شرایط خرید با شما تماس بگیرد.
            </p>
            <div className="mt-8 flex justify-center">
              <Link
                href="/contact?source=home-contact"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
              >
                درخواست تماس
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
            روکسیرا — نرم‌افزار ماژولار مدیریت کسب‌وکار
          </span>
          <span className="font-mono" dir="ltr">
            © 1405 Roxira · roxira.ir
          </span>
          <EnamadBadge domain="roxira" width={80} height={80} />
        </div>
      </footer>
    </div>
  );
}
