import Link from "next/link";
import {
  ArrowLeft,
  Boxes,
  Building2,
  Check,
  Coins,
  Cpu,
  FileCheck2,
  Layers,
  Radar,
  ReceiptText,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

const MODULES = [
  { href: "/accounting", label: "حسابداری", hint: "دفتر کل دوطرفه و گزارش‌های مالی", icon: Layers },
  { href: "/invoicing", label: "صورتحساب", hint: "صدور و امضای الکترونیک", icon: ReceiptText },
  { href: "/inventory", label: "انبارداری", hint: "موجودی و بهای تمام‌شده FIFO", icon: Boxes },
  { href: "/crm", label: "مدیریت مشتریان", hint: "سرنخ‌ها و پایپ‌لاین فروش", icon: Users },
  { href: "/hr", label: "منابع انسانی", hint: "کارکنان و دستمزد", icon: Building2 },
  { href: "/radar", label: "رادار فناوری", hint: "پایش فناوری و ایجنت‌ها", icon: Radar },
];

interface PricingTier {
  id: string;
  name: string;
  tagline: string;
  price: string;
  unit: string;
  highlight: boolean;
  icon: typeof FileCheck2;
  features: string[];
  cta: { href: string; label: string };
  cardClass: string;
  iconClass: string;
  checkClass: string;
  ctaClass: string;
}

const PRICING_TIERS: PricingTier[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "انطباق مالیاتی (سامانه مودیان)",
    price: "۲٬۹۰۰٬۰۰۰",
    unit: "تومان / ماه",
    highlight: false,
    icon: FileCheck2,
    features: [
      "صدور صورتحساب الکترونیکی و امضای دیجیتال",
      "تولید بسته مالیاتی و ثبت شماره مرجع در سامانه مودیان",
      "اتصال امن به وب‌سرویس‌های سازمانی",
      "۱ کاربر سازمانی",
      "پشتیبانی ایمیلی",
    ],
    cta: { href: "/invoicing", label: "شروع انطباق مالیاتی" },
    cardClass: "border-white/10 bg-white/[0.03]",
    iconClass: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    checkClass: "text-emerald-400",
    ctaClass:
      "border border-white/15 bg-white/5 text-slate-100 hover:border-emerald-400/40 hover:text-white",
  },
  {
    id: "business",
    name: "Business",
    tagline: "ERP و حسابداری یکپارچه",
    price: "۷٬۹۰۰٬۰۰۰",
    unit: "تومان / ماه",
    highlight: true,
    icon: Building2,
    features: [
      "همه امکانات طرح Starter",
      "حسابداری دوطرفه و دفتر کل",
      "انبارداری و بهای تمام‌شده کالا",
      "مدیریت مشتریان (CRM) و منابع انسانی",
      "دسترسی به وب‌سرویس‌های نسخه‌بندی‌شده",
      "پشتیبانی اولویت‌دار",
    ],
    cta: { href: "/accounting", label: "مشاهده ERP و حسابداری" },
    cardClass: "border-indigo-400/40 bg-indigo-500/[0.06] shadow-2xl shadow-indigo-900/30",
    iconClass: "border-indigo-400/30 bg-indigo-400/10 text-indigo-300",
    checkClass: "text-indigo-300",
    ctaClass:
      "bg-gradient-to-l from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-600/30",
  },
  {
    id: "foundry",
    name: "Foundry Developer",
    tagline: "کارخانه نرم‌افزار خودمختار",
    price: "۱۴٬۹۰۰٬۰۰۰",
    unit: "تومان / ماه",
    highlight: false,
    icon: Cpu,
    features: [
      "دسترسی کامل به کارخانه نرم‌افزار خودمختار",
      "کانتینر ایزوله و زیردامنه اختصاصی برای هر اپ",
      "اعتبار سندباکس پویا (Dynamic Sandbox Credits)",
      "بیلد و استقرار خودکار روی Docker",
      "دسترسی API و میز کنترل",
    ],
    cta: { href: "/admin/mission-control", label: "ورود به میز کنترل" },
    cardClass: "border-white/10 bg-white/[0.03]",
    iconClass: "border-violet-400/25 bg-violet-400/10 text-violet-300",
    checkClass: "text-violet-300",
    ctaClass:
      "border border-white/15 bg-white/5 text-slate-100 hover:border-violet-400/40 hover:text-white",
  },
];

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
              <span className="text-sm font-bold text-white">رکسایرا</span>
              <span className="font-mono text-[10px] text-slate-500" dir="ltr">
                Roxira Enterprise OS
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 text-sm md:flex">
            <Link href="/accounting" className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white">
              حسابداری
            </Link>
            <Link href="/invoicing" className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white">
              مالیات و صورتحساب
            </Link>
            <Link href="/crm" className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white">
              CRM
            </Link>
            <Link href="/admin/mission-control" className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white">
              کارخانه نرم‌افزار
            </Link>
          </nav>

          <Link
            href="/admin/mission-control"
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
          >
            <Sparkles className="size-3.5" />
            اجرای کارخانه نرم‌افزار
          </Link>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,rgba(99,102,241,0.14),transparent_70%)]" />
          <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 font-mono text-[11px] font-semibold text-indigo-300">
              <ServerCog className="size-3.5" />
              ROXIRA ENTERPRISE OS
            </span>
            <h1 className="mt-6 max-w-3xl text-3xl font-black leading-tight text-white sm:text-4xl">
              زیرساخت ابری یکپارچه سازمانی، کارخانه نرم‌افزار خودمختار و انطباق مالیاتی
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-slate-400">
              رکسایرا پورتال سازمانی یکپارچه‌ای است که ماژول‌های مالی، انبار، فروش و منابع
              انسانی را با کارخانه نرم‌افزار خودمختار و سامانه انطباق مالیاتی (مودیان) در یک
              بستر امن و مقیاس‌پذیر ترکیب می‌کند.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/invoicing"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-bold text-slate-950 transition-transform hover:-translate-y-0.5"
              >
                <FileCheck2 className="size-4" />
                سامانه انطباق مالیاتی
              </Link>
              <Link
                href="/admin/mission-control"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-xs font-bold text-slate-200 transition-colors hover:border-indigo-400/40 hover:text-white"
              >
                <Cpu className="size-4" />
                کارخانه نرم‌افزار خودمختار
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <span className="flex size-10 items-center justify-center rounded-xl border border-indigo-400/25 bg-indigo-400/10 text-indigo-300">
                <Building2 className="size-5" />
              </span>
              <h2 className="mt-4 text-base font-bold text-white">Roxira Enterprise OS</h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                هسته سازمانی ماژولار شامل حسابداری دوطرفه، انبارداری، مدیریت مشتریان و منابع
                انسانی؛ با معماری Controller-Service-Repository و API نسخه‌بندی‌شده.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/accounting" className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-indigo-400/40 hover:text-white">
                  حسابداری
                </Link>
                <Link href="/inventory" className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-indigo-400/40 hover:text-white">
                  انبارداری
                </Link>
                <Link href="/hr" className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-indigo-400/40 hover:text-white">
                  منابع انسانی
                </Link>
              </div>
            </article>

            <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <span className="flex size-10 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-400/10 text-violet-300">
                <Cpu className="size-5" />
              </span>
              <h2 className="mt-4 text-base font-bold text-white">Autonomous Software Foundry</h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                کارخانه نرم‌افزار خودمختار که از یک پرامپت، ماژول‌های سازمانی را می‌سازد، در
                محیط ایزوله Docker بیلد و اجرا می‌کند و مسیر سرویس را به‌صورت خودکار ثبت می‌نماید.
              </p>
              <Link
                href="/admin/mission-control"
                className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-[11px] font-semibold text-violet-200 transition-colors hover:bg-violet-400/20"
              >
                میز کنترل و اجرای ساخت
                <ArrowLeft className="size-3.5" />
              </Link>
            </article>

            <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <span className="flex size-10 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-300">
                <FileCheck2 className="size-5" />
              </span>
              <h2 className="mt-4 text-base font-bold text-white">Tax Compliance ERP</h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                انطباق کامل با سامانه مودیان: صدور صورتحساب الکترونیکی، امضای دیجیتال، تولید
                بسته مالیاتی و ثبت شماره مرجع به‌صورت یکپارچه با ماژول مالی.
              </p>
              <Link
                href="/invoicing"
                className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/20"
              >
                سامانه انطباق مالیاتی
                <ArrowLeft className="size-3.5" />
              </Link>
            </article>
          </div>
        </section>

        <section className="border-t border-white/10 bg-white/[0.015]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="flex items-center gap-2">
              <Layers className="size-4 text-indigo-300" />
              <h2 className="text-lg font-bold text-white">ماژول‌های یکپارچه پورتال سازمانی</h2>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              هر ماژول مستقل، مقیاس‌پذیر و از طریق وب‌سرویس‌های نسخه‌بندی‌شده قابل اتصال است.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {MODULES.map((module) => {
                const Icon = module.icon;
                return (
                  <Link
                    key={module.href}
                    href={module.href}
                    className="group flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-900/40 p-4 transition-colors hover:border-indigo-400/40 hover:bg-slate-900/70"
                  >
                    <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-300">
                      <Icon className="size-4" />
                    </span>
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold text-slate-100 group-hover:text-white">
                        {module.label}
                      </span>
                      <span className="mt-0.5 text-[11px] text-slate-500">{module.hint}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <section id="pricing" className="border-t border-white/10 bg-white/[0.015]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 font-mono text-[11px] font-semibold text-indigo-300">
                <Coins className="size-3.5" />
                B2B PRICING
              </span>
              <h2 className="mt-5 text-2xl font-black text-white sm:text-3xl">
                طرح‌های سازمانی رکسایرا
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                از انطباق مالیاتی تا ERP یکپارچه و کارخانه نرم‌افزار خودمختار — متناسب با مقیاس
                سازمان شما.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
              {PRICING_TIERS.map((tier) => {
                const Icon = tier.icon;
                return (
                  <article
                    key={tier.id}
                    className={`relative flex flex-col rounded-3xl border p-7 ${tier.cardClass}`}
                  >
                    {tier.highlight && (
                      <span className="absolute -top-3 right-6 rounded-full bg-gradient-to-l from-indigo-500 to-violet-600 px-3 py-1 text-[10px] font-bold text-white shadow-lg shadow-indigo-600/30">
                        پیشنهاد ویژه
                      </span>
                    )}

                    <span
                      className={`flex size-11 items-center justify-center rounded-2xl border ${tier.iconClass}`}
                    >
                      <Icon className="size-5" />
                    </span>

                    <h3 className="mt-5 text-lg font-black text-white">{tier.name}</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-300">{tier.tagline}</p>

                    <div className="mt-6 flex items-end gap-1.5">
                      <span className="font-mono text-2xl font-black text-white">{tier.price}</span>
                      <span className="pb-1 text-[11px] text-slate-500">{tier.unit}</span>
                    </div>

                    <ul className="mt-6 flex-1 space-y-3">
                      {tier.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-xs text-slate-300">
                          <Check className={`mt-0.5 size-3.5 shrink-0 ${tier.checkClass}`} />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <Link
                      href={tier.cta.href}
                      className={`mt-8 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-xs font-bold transition-all hover:-translate-y-0.5 ${tier.ctaClass}`}
                    >
                      {tier.cta.label}
                      <ArrowLeft className="size-3.5" />
                    </Link>
                  </article>
                );
              })}
            </div>

            <p className="mt-8 text-center text-[11px] text-slate-500">
              اعتبار سندباکس در طرح Foundry Developer پویاست و بر اساس زمان ساخت و اجرای هر اپ در
              محیط ایزوله محاسبه می‌شود.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-slate-950">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-center text-[11px] text-slate-500 sm:flex-row sm:px-6 sm:text-right">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3 text-emerald-400" />
            رکسایرا — زیرساخت سازمانی، کارخانه نرم‌افزار و انطباق مالیاتی
          </span>
          <span className="font-mono" dir="ltr">
            © 1405 Roxira · roxira.ir
          </span>
        </div>
      </footer>
    </div>
  );
}
