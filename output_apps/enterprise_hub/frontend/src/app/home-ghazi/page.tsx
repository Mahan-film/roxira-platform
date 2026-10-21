import { EnamadBadge } from "@/components/layout/EnamadBadge";
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { GhaziMark } from '@/components/brand/GhaziMark';
import { HeroAsk } from '@/components/landing/hero-ask';
import { LANDING_NAV, LOGIN_HREF } from '@/components/landing/landing-nav';
import { LandingMobileMenu } from '@/components/landing/landing-mobile-menu';
import { JsonLd } from '@/components/seo/json-ld';
import { loadCoverageTotals } from '@/lib/coverage';
import { GUIDE_SLUGS } from '@/lib/guides';
import { LEVEL_COPY } from '@/lib/plan-catalog';
import './landing.css';

export const metadata: Metadata = {
  title: 'سامانه قاضی هوشمند | دستیار هوش مصنوعی و جستجوی قوانین ایران',
  description:
    'سامانه قاضی هوشمند: مشاوره حقوقی فوری مبتنی بر هوش مصنوعی، تنظیم دادخواست و لایحه، و جستجوی هوشمند در بیش از ۴,۰۰۰ ماده قانون و آرای وحدت رویه.',
  keywords: [
    'قاضی هوشمند',
    'سامانه قاضی هوشمند',
    'هوش مصنوعی حقوقی',
    'مشاوره حقوقی آنلاین',
    'تنظیم دادخواست با هوش مصنوعی',
    'قوانین ایران',
    'استعلام مواد قانون',
  ],
  alternates: {
    canonical: 'https://ghazihoushmand.ir/',
  },
  openGraph: {
    title: 'سامانه قاضی هوشمند | دستیار تخصصی حقوقی هوش مصنوعی',
    description:
      'تحلیل پرونده، تنظیم لوایح قضایی و پاسخگویی مستند به متن صریح قوانین رسمی کشور.',
    url: 'https://ghazihoushmand.ir/',
    siteName: 'سامانه قاضی هوشمند',
    locale: 'fa_IR',
    type: 'website',
    images: [
      {
        url: 'https://ghazihoushmand.ir/brand/ghazi-emblem-og.jpg',
        width: 1024,
        height: 1024,
        alt: 'نشان قاضی هوشمند',
      },
    ],
  },
};

/** فقط اسکیمای FAQ؛ هویت برند (Organization/WebSite) در `layout.tsx` منتشر می‌شود. */
const FAQ_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'FAQPage',
      '@id': 'https://ghazihoushmand.ir/#faq',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'آیا پاسخ‌های قاضی هوشمند در مراجع قضایی قابل استناد است؟',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'پاسخ‌ها حاوی شماره مواد و متن صریح قوانین معتبر ایران هستند تا بتوانید آن‌ها را در منبع رسمی بررسی کنید؛ سامانه جایگزین مشاوره و وکالت نیست.',
          },
        },
        {
          '@type': 'Question',
          name: 'تفاوت سامانه قاضی هوشمند با هوش مصنوعی‌های عمومی مانند ChatGPT چیست؟',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'مدل‌های عمومی دچار توهم حقوقی و ارجاع اشتباه می‌شوند؛ قاضی هوشمند به پایگاه دانش به‌روز قوانین ایران با تفکیک مواد منسوخ و معتبر و آرای وحدت رویه متصل است.',
          },
        },
        {
          '@type': 'Question',
          name: 'آیا برای شروع پرسش نیاز به پرداخت هزینه است؟',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'خیر، مشاوره اولیه و کاوش در متن مواد قوانین برای همه کاربران کاملاً رایگان است.',
          },
        },
      ],
    },
  ],
};

const TRUST = ['بدون نیاز به کارت', 'ارتباط HTTPS', 'ارجاع به شماره ماده و تبصره', 'قوانین ۱۴۰۵'];

const STEPS = [
  { t: 'پرسش را بنویس', d: 'مشکل را به زبان ساده بنویس یا تصویر اسناد و قرارداد را بفرست.' },
  { t: 'قانون بررسی می‌شود', d: 'قوانین جاری، آرای وحدت رویه و بخشنامه‌ها با هم تطبیق داده می‌شوند.' },
  { t: 'پاسخ مستند بگیر', d: 'شماره مواد، مرجع صالح، مهلت‌ها و پیش‌نویس لایحه را تحویل بگیر.' },
];

const FEATURES = [
  { t: 'پاسخ‌گویی در هر ساعت', d: 'ملکی، خانواده، چک، ارث، کار و قراردادها؛ بدون معطلی.' },
  { t: 'تنظیم دادخواست و شکواییه', d: 'ساختار استاندارد همراه با دلایل و مستندات قانونی.' },
  { t: 'تحلیل اسناد و پرونده‌ها', d: 'بررسی ریسک و تعهدات ناخواسته در قرارداد و اوراق قضایی.' },
  { t: 'جستجوی دقیق در قوانین', d: 'متن پالایش‌شده قوانین و بخشنامه‌ها با ارجاع مستقیم.' },
  { t: 'دادگاه صالح و مهلت‌ها', d: 'تعیین مرجع رسیدگی و مهلت‌های حیاتی تجدیدنظر.' },
  { t: 'خسارت تأخیر تأدیه', d: 'روش محاسبه خسارت تأخیر چک و مطالبات مالی.' },
];

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: 'آیا پاسخ‌های قاضی هوشمند در مراجع قضایی قابل استناد است؟',
    a: 'پاسخ‌های سامانه همواره مستند به شماره مواد صریح و تبصره‌های قوانین معتبر جمهوری اسلامی ایران است. پیش از استفاده در لایحه یا دادخواست، متن ماده را در منبع رسمی بررسی کنید یا با وکیل مشورت کنید.',
  },
  {
    q: 'آیا اطلاعات و فایل‌های بارگذاری‌شده من محرمانه می‌ماند؟',
    a: (
      <>
        ارتباط با سایت رمزنگاری‌شده (HTTPS) است. برای پاسخ‌گویی، متن پرسش به سرویس‌دهنده مدل هوش مصنوعی ارسال می‌شود؛ جزئیات در صفحه{' '}
        <Link href="/privacy" className="font-semibold text-cyan-300 underline">
          حریم خصوصی
        </Link>{' '}
        آمده است.
      </>
    ),
  },
  {
    q: 'تفاوت قاضی هوشمند با هوش مصنوعی‌های عمومی (مانند ChatGPT) چیست؟',
    a: 'هوش مصنوعی‌های عمومی قوانین ایران را به درستی نمی‌شناسند و گاهی شماره مواد جعلی یا منسوخ می‌سازند. قاضی هوشمند از موتور جستجوی دقیق روی متن منقح قوانین و آرای وحدت رویه بهره می‌برد.',
  },
  {
    q: 'آیا استفاده از سامانه هزینه دارد؟',
    a: 'طرح سؤالات حقوقی اولیه و جستجو در مواد قانون رایگان است. برای نگارش لوایح تخصصی و بررسی پرونده‌های چندصفحه‌ای، اشتراک‌های مقرون‌به‌صرفه تعریف شده است.',
  },
];

function Check() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-cyan-300" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-8 text-center sm:mb-12">
      <p className="text-xs font-bold text-cyan-300">{kicker}</p>
      <h2 className="mt-2 text-2xl font-black leading-snug text-white sm:text-3xl">{title}</h2>
    </div>
  );
}

export default function HomeGhaziPage() {
  const { laws, articles } = loadCoverageTotals();
  const fa = new Intl.NumberFormat('fa-IR');
  const STATS = [
    { n: fa.format(articles), l: 'ماده قانونی در پایگاه' },
    { n: fa.format(laws), l: 'قانون اصلی پوشش‌داده‌شده' },
    { n: fa.format(GUIDE_SLUGS.length), l: 'راهنمای حقوقی منتشرشده' },
  ];

  return (
    <div dir="rtl" className="gl-root min-h-screen font-sans selection:bg-amber-400/40 selection:text-white">
      <JsonLd id="ghazi-landing-faq-jsonld" data={FAQ_JSON_LD} />

      {/* Header: mark + name, desktop nav, login pill, mobile hamburger */}
      <header className="gl-header sticky top-0 z-50 w-full">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 sm:h-16 sm:px-6 lg:px-8">
          <Link href="/" className="gl-focus flex min-w-0 items-center gap-2 rounded-lg">
            <GhaziMark className="h-9 w-9 shrink-0" />
            <span className="truncate text-base font-black text-white sm:text-lg">قاضی هوشمند</span>
          </Link>

          <nav aria-label="ناوبری اصلی" className="hidden items-center gap-0.5 text-[13px] font-semibold text-slate-300 lg:flex xl:text-sm">
            {LANDING_NAV.map((n) => (
              <Link key={n.href} href={n.href} className="gl-focus rounded-xl px-2.5 py-2 transition-colors hover:bg-white/5 hover:text-amber-300 xl:px-3.5">
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={LOGIN_HREF}
              className="gl-btn gl-focus inline-flex h-10 items-center rounded-full px-4 text-[13px] font-black sm:px-5 sm:text-sm"
            >
              <span className="sm:hidden">ورود / ثبت‌نام</span>
              <span className="hidden sm:inline">ورود / ثبت‌نام سریع</span>
            </Link>
            <LandingMobileMenu />
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="gl-grid absolute inset-0" aria-hidden="true" />
          <div className="gl-glow -top-40 left-1/2 h-[320px] w-[560px] -translate-x-1/2 bg-amber-500/10" aria-hidden="true" />
          <div className="gl-glow top-40 -end-40 h-[300px] w-[420px] bg-sky-500/10" aria-hidden="true" />

          <div className="relative mx-auto grid max-w-7xl items-center gap-8 px-4 pb-14 pt-8 sm:px-6 sm:pb-20 sm:pt-12 lg:grid-cols-2 lg:gap-10 lg:px-8 lg:pt-16">
            <div className="text-center lg:text-start">
              <p className="gl-fade-1 gl-glass inline-flex items-center gap-2.5 rounded-full border-amber-400/25 px-4 py-2 text-xs font-bold text-amber-300">
                <span aria-hidden="true" className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                </span>
                دستیار هوشمند حقوقی بر پایه هوش مصنوعی
              </p>

              <h1 className="gl-fade-2 mt-6 text-[1.75rem] font-black leading-[1.5] tracking-tight text-white sm:text-5xl sm:leading-[1.4]">
                پاسخ حقوقی مطمئن و مستند به قانون،{' '}
                <span className="gl-gold">در چند ثانیه</span>
              </h1>

              <p className="gl-fade-3 mx-auto mt-4 max-w-xl text-[15px] leading-8 text-slate-300 sm:text-lg lg:mx-0">
                پرسشت را بنویس؛ پاسخ را با شماره ماده و تبصره بگیر، دادخواست و لایحه تنظیم کن.
              </p>

              <div className="gl-fade-3 mt-7 text-start">
                <HeroAsk />
              </div>

              <ul className="mt-5 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                {TRUST.map((t) => (
                  <li key={t} className="gl-glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-slate-200">
                    <Check />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            {/* Emblem: above the text on mobile, beside it on desktop. Explicit size = no layout shift. */}
            <div className="relative order-first mx-auto w-full max-w-[240px] sm:max-w-xs lg:order-last lg:max-w-none">
              <div className="gl-float">
                <Image
                  src="/brand/ghazi-emblem-720.webp"
                  alt="نشان قاضی هوشمند: ترازوی عدالت و چکش قضایی با مدارهای الکترونیکی"
                  width={720}
                  height={720}
                  priority
                  sizes="(min-width: 1024px) 480px, (min-width: 640px) 320px, 240px"
                  className="h-auto w-full [mask-image:radial-gradient(circle_at_center,#000_60%,transparent_71%)] [-webkit-mask-image:radial-gradient(circle_at_center,#000_60%,transparent_71%)]"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Stats: real numbers from the coverage manifest and the guide list */}
        <section aria-label="آمار پایگاه دانش" className="px-4 sm:px-6">
          <dl className="gl-glass mx-auto grid max-w-3xl grid-cols-3 divide-x divide-x-reverse divide-white/10 rounded-2xl py-4 text-center">
            {STATS.map((x) => (
              <div key={x.l} className="flex flex-col-reverse px-2">
                <dt className="mt-1 text-[11px] leading-5 text-slate-300 sm:text-sm">{x.l}</dt>
                <dd className="gl-gold text-xl font-black sm:text-3xl">{x.n}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How it works */}
        <section className="px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-5xl">
            <SectionTitle kicker="فرآیند ساده و سریع" title="در سه گام به راهکار حقوقی برس" />
            <ol className="grid gap-4 md:grid-cols-3">
              {STEPS.map((st, i) => (
                <li key={st.t} className="gl-card flex gap-4 p-5 md:flex-col">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-400/35 bg-amber-400/10 text-lg font-black text-amber-300">
                    {fa.format(i + 1)}
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-white">{st.t}</h3>
                    <p className="mt-1 text-sm leading-7 text-slate-300">{st.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section className="border-y border-white/5 bg-[#0a0f1a] px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-5xl">
            <SectionTitle kicker="قابلیت‌های پلتفرم" title="یک دستیار کامل برای همه ابعاد حقوقی" />
            <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.t} className="gl-card p-5">
                  <span aria-hidden="true" className="mb-3 block h-1 w-8 rounded-full bg-gradient-to-l from-amber-400 to-sky-400" />
                  <h3 className="text-base font-bold text-white">{f.t}</h3>
                  <p className="mt-1.5 text-sm leading-7 text-slate-300">{f.d}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Pricing teaser (no prices here: live prices live on /plans) */}
        <section className="px-4 py-14 sm:px-6 sm:py-20">
          <div className="gl-card mx-auto max-w-3xl p-6 text-center sm:p-10">
            <h2 className="text-xl font-black text-white sm:text-2xl">با رایگان شروع کن، هر وقت خواستی ارتقا بده</h2>
            <ul className="mt-5 flex flex-wrap justify-center gap-2">
              {(['free', 'basic', 'pro', 'premium', 'team'] as const).map((k) => (
                <li key={k} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
                  {LEVEL_COPY[k].title}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              پرسش‌های اولیه و جستجوی قوانین رایگان است. قیمت‌های لحظه‌ای هر طرح را در صفحه اشتراک‌ها ببین.
            </p>
            <Link
              href="/plans"
              className="gl-focus mt-6 inline-flex h-11 items-center justify-center rounded-xl border border-amber-400/60 px-6 text-sm font-bold text-amber-300 transition-colors hover:bg-amber-400/10"
            >
              مشاهده اشتراک‌ها
            </Link>
          </div>
        </section>

        {/* Disclaimer */}
        <section className="px-4 sm:px-6">
          <div className="mx-auto max-w-3xl rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5">
            <h3 className="text-base font-bold text-amber-200">شفافیت و تعهد حرفه‌ای</h3>
            <p className="mt-2 text-sm leading-7 text-slate-200">
              قاضی هوشمند ابزار ارتقای دانش حقوقی است و جایگزین وکالت و دفاع حضوری نیست. برای پرونده‌های دارای ریسک مالی یا کیفری بالا، پس از دریافت راهنمایی اولیه با وکیل دادگستری مشورت کنید.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className="px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <SectionTitle kicker="پاسخ به ابهامات شما" title="پرسش‌های متداول" />
            <div className="space-y-3">
              {FAQS.map((f) => (
                <details key={f.q} className="gl-card gl-card-static group p-4">
                  <summary className="gl-focus flex cursor-pointer list-none items-center justify-between gap-3 rounded-md text-sm font-bold text-white sm:text-base [&::-webkit-details-marker]:hidden">
                    <span>{f.q}</span>
                    <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-300 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden border-t border-white/5 bg-[#0a0f1a] px-4 py-16 text-center sm:px-6">
          <div className="gl-glow -top-24 left-1/2 h-[240px] w-[480px] -translate-x-1/2 bg-amber-500/10" aria-hidden="true" />
          <div className="relative">
            <h2 className="text-2xl font-black text-white sm:text-3xl">همین حالا پرسش حقوقی‌ات را بپرس</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
              راهکار قانونی، مواد مرتبط و مراحل پیگیری را در چند ثانیه ببین.
            </p>
            <Link href="/chat" className="gl-btn gl-focus mt-6 inline-flex h-12 items-center justify-center rounded-xl px-8 text-base font-black">
              شروع گفتگوی رایگان
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 bg-[#05080f] px-4 py-10 text-sm text-slate-300 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-center justify-between gap-5 sm:flex-row">
            <p className="flex items-center gap-2">
              <GhaziMark className="h-7 w-7" />
              <span className="font-bold text-white">سامانه قاضی هوشمند</span>
              <span className="hidden text-slate-400 md:inline">— پلتفرم هوش مصنوعی قوانین و دادرسی ایران</span>
            </p>
            <nav aria-label="پیوندهای پایانی" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
              <Link href="/privacy" className="gl-focus rounded hover:text-amber-300">حریم خصوصی</Link>
              <Link href="/terms" className="gl-focus rounded hover:text-amber-300">شرایط استفاده</Link>
              <Link href="/contact" className="gl-focus rounded hover:text-amber-300">تماس با ما</Link>
              <Link href="/support" className="gl-focus rounded hover:text-amber-300">پشتیبانی</Link>
            </nav>
          </div>
          {/* نماد اعتماد الکترونیکی: همیشه در پایین صفحه، با کد رسمی اینماد (بدون rel/noreferrer). */}
          <div className="mt-8 flex flex-col items-center gap-2">
            <div className="rounded-2xl bg-white p-2 shadow-lg shadow-black/40">
              <EnamadBadge domain="ghazi" width={88} height={88} className="block w-[88px]" />
            </div>
            <span className="text-xs text-slate-400">نماد اعتماد الکترونیکی</span>
          </div>
          <p className="mt-6 border-t border-white/5 pt-6 text-center text-xs text-slate-400">
            تمامی حقوق مادی و معنوی متعلق به سامانه قاضی هوشمند است. استفاده از محتوا با ذکر منبع بلامانع است.
          </p>
        </div>
      </footer>
    </div>
  );
}
