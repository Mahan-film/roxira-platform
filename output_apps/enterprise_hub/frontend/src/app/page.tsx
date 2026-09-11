import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  BrainCircuit,
  Calculator,
  Database,
  FileText,
  Lock,
  Network,
  ReceiptText,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { RoxiraFooter } from "@/components/layout/roxira-footer";
import { SiteHeader } from "@/components/layout/site-header";

const TRUST_METRICS = [
  {
    icon: Server,
    title: "پایداری و دسترس‌پذیری بالا",
    description:
      "معماری ابری چندلایه با پایش پیوسته، توزیع بار و دسترس‌پذیری ۲۴/۷ برای سرویس‌های حیاتی سازمان.",
  },
  {
    icon: BadgeCheck,
    title: "انطباق کامل با قوانین مالیاتی",
    description:
      "صدور صورتحساب منطبق بر الزامات سامانه مؤدیان و محاسبات رسمی بر پایه ماده ۵۲۲ قانون آیین دادرسی مدنی.",
  },
  {
    icon: Lock,
    title: "رمزنگاری و حفاظت از داده‌ها",
    description:
      "انتقال امن داده‌ها بر بستر TLS، تفکیک دسترسی‌ها و نگهداری رمزنگاری‌شده اسناد و سوابق سازمانی.",
  },
];

export default function Home() {
  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-border">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_420px_at_80%_-10%,rgba(79,70,229,0.28),transparent_60%),radial-gradient(700px_360px_at_10%_20%,rgba(34,211,238,0.10),transparent_60%)]"
          />
          <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-indigo-300">
              <Sparkles className="size-3.5" />
              پورتال سازمانی روکسیرا — Roxira Enterprise OS
            </span>
            <h1 className="max-w-3xl text-3xl font-black leading-[1.35] tracking-tight sm:text-5xl">
              راهکارهای نرم‌افزاری ابری برای
              <span className="bg-gradient-to-l from-indigo-400 to-cyan-300 bg-clip-text text-transparent">
                {" "}
                مدیریت مالی و اسناد مالیاتی سازمان
              </span>
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              یک‌پارچه‌سازی مدیریت اسناد مالیاتی، محاسبات رسمی سازمانی و اتصال امن به
              زیرساخت هوش مصنوعی؛ در بستری پایدار، منطبق با مقررات و مبتنی بر معماری
              ماژولار.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <Link
                href="/invoicing"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
              >
                <ReceiptText className="size-4" />
                ورود به سامانه فاکتور الکترونیک
              </Link>
              <Link
                href="/damages"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-bold text-foreground transition-colors hover:bg-accent"
              >
                <Calculator className="size-4" />
                شروع محاسبه رسمی خسارت
              </Link>
            </div>

            <dl className="mt-6 grid w-full max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
              {[
                { value: "۹٪", label: "مالیات بر ارزش افزوده" },
                { value: "ماده ۵۲۲", label: "مبنای محاسبه خسارت" },
                { value: "۲۴/۷", label: "دسترس‌پذیری سرویس" },
                { value: "TLS", label: "رمزنگاری انتقال داده" },
              ].map((stat) => (
                <div key={stat.label} className="bg-card px-3 py-4">
                  <dt className="text-lg font-black text-indigo-300">{stat.value}</dt>
                  <dd className="mt-1 text-[11px] text-muted-foreground">{stat.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-8 flex flex-col gap-2">
            <span className="text-xs font-bold text-indigo-300">ماژول‌های یکپارچه</span>
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
              سبد خدمات سازمانی روکسیرا
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              دسترسی مستقیم به سرویس‌های کلیدی پورتال؛ هر ماژول به‌صورت مستقل و
              متصل به هسته سازمانی ارائه می‌شود.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Link
              href="/invoicing"
              className="group flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 transition-colors hover:border-indigo-400/40 lg:col-span-2"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted">
                    <ReceiptText className="size-5 text-indigo-300" />
                  </span>
                  <h3 className="text-xl font-bold">سامانه صدور فاکتور الکترونیک</h3>
                  <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                    صدور و مدیریت صورتحساب‌های سازمانی با محاسبه آنی مالیات ۹٪،
                    مدیریت اقلام کالا و خدمت و ثبت سوابق مالیاتی.
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                  ماژول اصلی
                </span>
              </div>

              <div className="rounded-xl border border-border bg-background/60 p-4">
                <div className="flex items-center justify-between border-b border-border pb-2 text-[11px] font-semibold text-muted-foreground">
                  <span>پیش‌نمایش صورتحساب</span>
                  <span className="font-mono" dir="ltr">
                    INV-1405-0042
                  </span>
                </div>
                <ul className="divide-y divide-border text-xs">
                  <li className="flex items-center justify-between py-2.5">
                    <span className="text-muted-foreground">خدمات مشاوره سازمانی</span>
                    <span className="font-mono">۱۲۰٬۰۰۰٬۰۰۰</span>
                  </li>
                  <li className="flex items-center justify-between py-2.5">
                    <span className="text-muted-foreground">پشتیبانی و نگهداری سالانه</span>
                    <span className="font-mono">۴۵٬۰۰۰٬۰۰۰</span>
                  </li>
                </ul>
                <div className="flex items-center justify-between pt-2.5 text-xs">
                  <span className="text-muted-foreground">مالیات بر ارزش افزوده (۹٪)</span>
                  <span className="font-mono text-amber-300">۱۴٬۸۵۰٬۰۰۰</span>
                </div>
                <div className="mt-2 flex items-center justify-between rounded-lg bg-indigo-500/10 px-3 py-2 text-sm font-bold">
                  <span>مبلغ قابل پرداخت</span>
                  <span className="font-mono text-indigo-300">۱۷۹٬۸۵۰٬۰۰۰</span>
                </div>
              </div>

              <span className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-300">
                ورود به سامانه فاکتور
                <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
              </span>
            </Link>

            <Link
              href="/damages"
              className="group flex flex-col justify-between gap-5 rounded-2xl border border-border bg-card p-6 transition-colors hover:border-emerald-400/40"
            >
              <div className="flex flex-col gap-2">
                <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted">
                  <Calculator className="size-5 text-emerald-300" />
                </span>
                <h3 className="text-lg font-bold">محاسبه‌گر خسارت تاخیر تادیه</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  محاسبه دقیق خسارت بر اساس شاخص تورم بانک مرکزی و رویه ماده ۵۲۲
                  قانون آیین دادرسی مدنی.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground">
                  شاخص بانک مرکزی
                </span>
                <span className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground">
                  نرخ سود قراردادی
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-300">
                محاسبه خسارت
                <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
              </span>
            </Link>

            <Link
              href="/docs"
              className="group flex flex-col justify-between gap-5 rounded-2xl border border-border bg-card p-6 transition-colors hover:border-cyan-400/40"
            >
              <div className="flex flex-col gap-2">
                <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted">
                  <BookOpen className="size-5 text-cyan-300" />
                </span>
                <h3 className="text-lg font-bold">مستندات وب‌سرویس و درگاه API</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  مستندات رسمی سرویس‌های سازمانی و درگاه توسعه‌دهندگان برای
                  یکپارچه‌سازی سامانه‌های شما با پورتال روکسیرا.
                </p>
              </div>
              <code
                className="rounded-lg border border-border bg-background/60 px-3 py-2 font-mono text-[11px] text-cyan-300"
                dir="ltr"
              >
                GET /docs
              </code>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-cyan-300">
                مشاهده مستندات
                <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
              </span>
            </Link>

            <Link
              href="https://ghazihoushmand.ir"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 transition-colors hover:border-violet-400/40 lg:col-span-2"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted">
                    <BrainCircuit className="size-5 text-violet-300" />
                  </span>
                  <h3 className="text-xl font-bold">
                    اتصال امن به زیرساخت هوش مصنوعی سازمانی
                  </h3>
                  <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                    دسترسی به پایگاه دانش حقوقی و موتور استدلال سازمانی بر پایه
                    معماری GraphRAG؛ ترکیب جستجوی برداری، گراف دانش و مدل‌های
                    زبانی.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  { icon: Database, name: "Vector Store", detail: "جستجوی برداری Qdrant" },
                  { icon: Network, name: "Knowledge Graph", detail: "گراف دانش PostgreSQL" },
                  { icon: Sparkles, name: "LLM Dispatcher", detail: "دیسپچر چندسطحی مدل‌ها" },
                ].map(({ icon: Icon, name, detail }) => (
                  <div
                    key={name}
                    className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3 py-3"
                  >
                    <Icon className="size-4 shrink-0 text-violet-300" />
                    <div className="leading-tight">
                      <div className="font-mono text-[11px] text-foreground" dir="ltr">
                        {name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{detail}</div>
                    </div>
                  </div>
                ))}
              </div>

              <span className="inline-flex items-center gap-1 text-sm font-semibold text-violet-300">
                ورود به پایگاه دانش سازمانی
                <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
              </span>
            </Link>
          </div>
        </section>

        <section className="border-t border-border bg-card/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <div className="mb-8 flex flex-col items-center gap-2 text-center">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                <ShieldCheck className="size-4" />
                معیارهای اعتماد سازمانی
              </span>
              <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
                امنیت و انطباق در سطح سازمان
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                زیرساخت روکسیرا برای بارهای کاری حساس مالی و حقوقی طراحی شده است؛
                پایدار، منطبق بر مقررات و حافظ داده‌های سازمان.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {TRUST_METRICS.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-muted">
                    <Icon className="size-5 text-emerald-300" />
                  </span>
                  <h3 className="font-bold">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-xs text-muted-foreground">
              <FileText className="size-4 text-indigo-300" />
              <span>
                آماده شروع هستید؟ سامانه فاکتور الکترونیک و محاسبه‌گر رسمی خسارت
                بدون نیاز به نصب در دسترس شماست.
              </span>
              <Link
                href="/invoicing"
                className="font-semibold text-indigo-300 transition-colors hover:text-indigo-200"
              >
                شروع کنید
              </Link>
            </div>
          </div>
        </section>
      </main>

      <RoxiraFooter />
    </div>
  );
}
