import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { JsonLd } from '@/components/seo/json-ld';
import { loadCoverageTotals } from '@/lib/coverage';
import { GUIDE_SLUGS } from '@/lib/guides';
import { LEVEL_COPY } from '@/lib/plan-catalog';

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

const NAV = [
  { href: '/laws', label: 'مجموعه قوانین' },
  { href: '/regulations', label: 'بخشنامه‌ها' },
  { href: '/guide', label: 'راهنمای استفاده' },
  { href: '/plans', label: 'تعرفه‌ها و خدمات' },
  { href: '/about', label: 'درباره سامانه' },
];

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
        <Link href="/privacy" className="font-semibold text-blue-900 underline dark:text-amber-400">
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

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-900 focus-visible:ring-offset-2 dark:focus-visible:ring-amber-400 dark:focus-visible:ring-offset-slate-950';

function Check() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-8 text-center sm:mb-12">
      <p className="text-xs font-bold text-amber-700 dark:text-amber-400">{kicker}</p>
      <h2 className="mt-2 text-2xl font-black leading-snug text-slate-900 sm:text-3xl dark:text-white">{title}</h2>
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
    <div dir="rtl" className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-amber-500 selection:text-white dark:bg-slate-950 dark:text-slate-100">
      <JsonLd id="ghazi-landing-faq-jsonld" data={FAQ_JSON_LD} />

      {/* Header: compact on mobile (logo + name + small CTA + menu) */}
      <header className="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/90">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 sm:h-16 sm:px-6 lg:px-8">
          <Link href="/" className={`flex min-w-0 items-center gap-2 rounded-lg ${FOCUS}`}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-900 text-amber-400">
              <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l9-4 9 4M3 6v14l9 4 9-4V6M3 6l9 4 9-4m-9 4v14" />
              </svg>
            </span>
            <span className="truncate text-base font-black text-blue-950 sm:text-lg dark:text-white">قاضی هوشمند</span>
          </Link>

          <nav aria-label="ناوبری اصلی" className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex dark:text-slate-300">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="transition-colors hover:text-blue-900 dark:hover:text-amber-400">
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/chat"
              className={`inline-flex h-9 items-center rounded-lg bg-blue-900 px-3 text-[13px] font-bold text-white transition-colors hover:bg-blue-800 sm:px-4 sm:text-sm dark:bg-blue-600 dark:hover:bg-blue-500 ${FOCUS}`}
            >
              <span className="sm:hidden">شروع</span>
              <span className="hidden sm:inline">شروع رایگان گفتگو</span>
            </Link>
            <details className="group relative md:hidden">
              <summary
                aria-label="منوی صفحات"
                className={`flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200 [&::-webkit-details-marker]:hidden ${FOCUS}`}
              >
                <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </summary>
              <div className="absolute start-0 top-11 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                    {n.label}
                  </Link>
                ))}
              </div>
            </details>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-b from-blue-50 via-slate-50 to-slate-50 px-4 pb-12 pt-10 sm:px-6 sm:pb-20 sm:pt-16 dark:from-blue-950/40 dark:via-slate-950 dark:to-slate-950">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" />
              دستیار حقوقی مبتنی بر متن مصوب قوانین
            </p>

            <h1 className="mt-5 text-[1.75rem] font-black leading-[1.45] tracking-tight text-slate-900 sm:text-5xl sm:leading-[1.35] dark:text-white">
              پاسخ حقوقی مطمئن و مستند به قانون،{' '}
              <span className="text-blue-900 dark:text-amber-400">در چند ثانیه</span>
            </h1>

            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-8 text-slate-600 sm:text-lg dark:text-slate-300">
              پرسشت را بنویس؛ پاسخ را با شماره ماده و تبصره بگیر، دادخواست و لایحه تنظیم کن.
            </p>

            <div className="mx-auto mt-7 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
              <Link
                href="/chat"
                className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-900 px-8 text-base font-bold text-white shadow-md shadow-blue-950/20 transition-colors hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 ${FOCUS}`}
              >
                سؤال حقوقی‌ات را بپرس
              </Link>
              <Link
                href="/laws"
                className={`inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-8 text-base font-bold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 ${FOCUS}`}
              >
                جستجوی متن قوانین
              </Link>
            </div>

            <ul className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {TRUST.map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  <Check />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Stats: real numbers from the coverage manifest and the guide list */}
        <section aria-label="آمار پایگاه دانش" className="px-4 sm:px-6">
          <dl className="mx-auto grid max-w-3xl grid-cols-3 divide-x divide-x-reverse divide-slate-200 rounded-2xl border border-slate-200 bg-white py-4 text-center shadow-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {STATS.map((x) => (
              <div key={x.l} className="flex flex-col-reverse px-2">
                <dt className="mt-1 text-[11px] leading-5 text-slate-600 sm:text-sm dark:text-slate-400">{x.l}</dt>
                <dd className="text-xl font-black text-blue-900 sm:text-3xl dark:text-amber-400">{x.n}</dd>
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
                <li key={st.t} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:flex-col dark:border-slate-800 dark:bg-slate-900">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-lg font-black text-blue-900 dark:bg-blue-950 dark:text-blue-300">
                    {fa.format(i + 1)}
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">{st.t}</h3>
                    <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-400">{st.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section className="border-y border-slate-200/80 bg-white px-4 py-14 sm:px-6 sm:py-20 dark:border-slate-800/80 dark:bg-slate-900/40">
          <div className="mx-auto max-w-5xl">
            <SectionTitle kicker="قابلیت‌های پلتفرم" title="یک دستیار کامل برای همه ابعاد حقوقی" />
            <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.t} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">{f.t}</h3>
                  <p className="mt-1.5 text-sm leading-7 text-slate-600 dark:text-slate-400">{f.d}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Pricing teaser (no prices here: live prices live on /plans) */}
        <section className="px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 text-center sm:p-10 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-xl font-black text-slate-900 sm:text-2xl dark:text-white">با رایگان شروع کن، هر وقت خواستی ارتقا بده</h2>
            <ul className="mt-5 flex flex-wrap justify-center gap-2">
              {(['free', 'basic', 'pro', 'premium'] as const).map((k) => (
                <li key={k} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {LEVEL_COPY[k].title}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-400">
              پرسش‌های اولیه و جستجوی قوانین رایگان است. قیمت‌های لحظه‌ای هر طرح را در صفحه تعرفه‌ها ببین.
            </p>
            <Link
              href="/plans"
              className={`mt-6 inline-flex h-11 items-center justify-center rounded-xl border border-blue-900 px-6 text-sm font-bold text-blue-900 transition-colors hover:bg-blue-50 dark:border-amber-400 dark:text-amber-400 dark:hover:bg-slate-800 ${FOCUS}`}
            >
              مشاهده تعرفه‌ها
            </Link>
          </div>
        </section>

        {/* Disclaimer */}
        <section className="px-4 sm:px-6">
          <div className="mx-auto max-w-3xl rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/20">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">شفافیت و تعهد حرفه‌ای</h3>
            <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-300">
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
                <details key={f.q} className="group rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <summary className={`flex cursor-pointer list-none items-center justify-between gap-3 rounded-md text-sm font-bold text-slate-900 sm:text-base dark:text-white [&::-webkit-details-marker]:hidden ${FOCUS}`}>
                    <span>{f.q}</span>
                    <svg aria-hidden="true" className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-400">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-blue-900 px-4 py-14 text-center text-white sm:px-6 dark:bg-blue-950">
          <h2 className="text-2xl font-black sm:text-3xl">همین حالا پرسش حقوقی‌ات را بپرس</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-blue-100 sm:text-base">
            راهکار قانونی، مواد مرتبط و مراحل پیگیری را در چند ثانیه ببین.
          </p>
          <Link
            href="/chat"
            className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-amber-500 px-8 text-base font-bold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-blue-900"
          >
            شروع گفتگوی رایگان
          </Link>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-10 text-sm text-slate-600 sm:px-6 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-center justify-between gap-5 sm:flex-row">
            <p>
              <span className="font-bold text-slate-900 dark:text-white">سامانه قاضی هوشمند</span>
              <span> — پلتفرم هوش مصنوعی قوانین و دادرسی ایران</span>
            </p>
            <nav aria-label="پیوندهای پایانی" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
              <Link href="/privacy" className="hover:underline">حریم خصوصی</Link>
              <Link href="/terms" className="hover:underline">شرایط استفاده</Link>
              <Link href="/contact" className="hover:underline">تماس و پشتیبانی</Link>
            </nav>
          </div>
          <p className="mt-6 border-t border-slate-100 pt-6 text-center text-xs text-slate-600 dark:border-slate-900 dark:text-slate-400">
            تمامی حقوق مادی و معنوی متعلق به سامانه قاضی هوشمند است. استفاده از محتوا با ذکر منبع بلامانع است.
          </p>
        </div>
      </footer>
    </div>
  );
}
