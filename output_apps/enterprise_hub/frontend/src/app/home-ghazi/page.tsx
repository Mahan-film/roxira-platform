import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/seo/json-ld';

export const metadata: Metadata = {
  title: 'سامانه قاضی هوشمند | دستیار هوش مصنوعی و جستجوی قوانین ایران',
  description:
    'سامانه قاضی هوشمند: مشاوره حقوقی فوری مبتنی بر هوش مصنوعی، تنظیم دادخواست و لایحه، و جستجوی هوشمند در بیش از ۵,۷۰۰ ماده قانون و آرای وحدت رویه.',
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

export default function HomeGhaziPage() {
  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100 font-sans selection:bg-amber-500 selection:text-white">
      {/* اسکیما مارک‌آپ استاندارد */}
      <JsonLd id="ghazi-landing-faq-jsonld" data={FAQ_JSON_LD} />

      {/* ناوبری اصلی */}
      <header className="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/90">
        <div className="container mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-900 text-amber-400 shadow-md shadow-blue-950/20">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l9-4 9 4M3 6v14l9 4 9-4V6M3 6l9 4 9-4m-9 4v14" />
              </svg>
            </div>
            <div>
              <span className="text-lg font-black tracking-tight text-blue-950 dark:text-white">
                سامانه قاضی هوشمند
              </span>
              <span className="me-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                قوانین ۱۴۰۵
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600 dark:text-slate-300">
            <Link href="/laws" className="transition-colors hover:text-blue-900 dark:hover:text-amber-400">
              مجموعه قوانین
            </Link>
            <Link href="/regulations" className="transition-colors hover:text-blue-900 dark:hover:text-amber-400">
              بخشنامه‌ها
            </Link>
            <Link href="/guide" className="transition-colors hover:text-blue-900 dark:hover:text-amber-400">
              راهنمای استفاده
            </Link>
            <Link href="/plans" className="transition-colors hover:text-blue-900 dark:hover:text-amber-400">
              تعرفه‌ها و خدمات
            </Link>
            <Link href="/about" className="transition-colors hover:text-blue-900 dark:hover:text-amber-400">
              درباره سامانه
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              className="inline-flex items-center justify-center rounded-lg bg-blue-900 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-800 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-900 focus:ring-offset-2 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              شروع رایگان گفتگو
            </Link>
          </div>
        </div>
      </header>

      {/* بخش هیرو */}
      <section className="relative overflow-hidden pt-12 pb-20 md:pt-20 md:pb-32">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50/80 px-4 py-1.5 text-xs font-semibold text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              مبتنی بر متن مصوب مجلس، آرای وحدت رویه و بخشنامه‌های رسمی
            </div>

            <h1 className="text-3xl font-black tracking-tight text-slate-900 sm:text-5xl lg:text-6xl dark:text-white leading-[1.25]">
              پاسخ حقوقی مطمئن و مستند به قانون،{' '}
              <span className="text-blue-900 dark:text-amber-400 underline decoration-amber-400 decoration-wavy decoration-2">
                در چند ثانیه
              </span>
            </h1>

            <p className="mt-6 text-base sm:text-lg leading-relaxed text-slate-600 dark:text-slate-300">
              سامانه قاضی هوشمند با جستجو در بیش از ۵,۷۰۰ ماده قانون و مقررات رسمی ایران، در تحلیل پرونده‌های قضایی، تنظیم دادخواست و شکواییه و پاسخگویی به پیچیده‌ترین مسائل حقوقی در کنار شماست.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/chat"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-blue-900 px-8 py-4 text-base font-bold text-white shadow-lg shadow-blue-950/20 transition-all hover:bg-blue-800 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-900 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                <span>سؤال حقوقی‌ات را بپرس</span>
                <svg className="h-5 w-5 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
              <Link
                href="/laws"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-8 py-4 text-base font-bold text-slate-700 shadow-sm transition-all hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                جستجوی متن قوانین
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                بدون نیاز به کارت در اولین سؤال
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                ارتباط رمزنگاری‌شده (HTTPS)
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                ارجاع صریح به شماره مواد و تبصره‌ها
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* نحوه کارکرد سیستم (۳ گام) */}
      <section className="border-t border-slate-200/80 bg-white py-16 dark:border-slate-800/80 dark:bg-slate-900">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              فرآیند ساده و سریع
            </h2>
            <p className="mt-2 text-2xl font-black text-slate-900 sm:text-3xl dark:text-white">
              چگونه در سه گام به راهکار حقوقی برسیم؟
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="relative rounded-2xl border border-slate-200 bg-slate-50/50 p-6 dark:border-slate-800 dark:bg-slate-950/50">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-900 font-black text-lg dark:bg-blue-950 dark:text-blue-300">
                ۱
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">شرح مسئله یا بارگذاری مدارک</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                مشکل یا پرسش خود را به زبان ساده بنویسید یا تصویر اسناد، قراردادها و اخطاریه قضایی‌تان را آپلود کنید.
              </p>
            </div>

            <div className="relative rounded-2xl border border-slate-200 bg-slate-50/50 p-6 dark:border-slate-800 dark:bg-slate-950/50">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-900 font-black text-lg dark:bg-blue-950 dark:text-blue-300">
                ۲
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">واکاوی هوشمند قوانین و مقررات</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                موتور تخصصی قاضی هوشمند قوانین جاری، نسخ‌ها، آرای وحدت رویه و بخشنامه‌ها را بررسی و تطبیق می‌دهد.
              </p>
            </div>

            <div className="relative rounded-2xl border border-slate-200 bg-slate-50/50 p-6 dark:border-slate-800 dark:bg-slate-950/50">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-900 font-black text-lg dark:bg-blue-950 dark:text-blue-300">
                ۳
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">دریافت پاسخ مستند و نگارش سند</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                پاسخ شفاف به همراه شماره مواد قانونی، مرجع صالح، مواعد اعتراض و پیش‌نویس لایحه دفاعیه را تحویل بگیرید.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* قابلیت‌های شش‌گانه */}
      <section className="py-20">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-xs font-bold uppercase tracking-wider text-blue-900 dark:text-amber-400">
              قابلیت‌های پلتفرم
            </h2>
            <p className="mt-2 text-2xl font-black text-slate-900 sm:text-3xl dark:text-white">
              یک دستیار کامل برای همه ابعاد حقوقی شما
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* کارت ۱ */}
            <div className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-blue-900/30 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-900 dark:bg-blue-950/80 dark:text-blue-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">پاسخ‌گویی در هر ساعت</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                طرح هرگونه پرسش در زمینه‌های ملکی، خانواده، چک، ارث، کار و قراردادها بدون معطلی و در هر ساعت از شبانه‌روز.
              </p>
            </div>

            {/* کارت ۲ */}
            <div className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-blue-900/30 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-900 dark:bg-blue-950/80 dark:text-blue-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">تنظیم دادخواست و شکواییه</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                تولید ساختار استاندارد حقوقی برای تقدیم به دفاتر خدمات الکترونیک قضایی همراه با دلایل و مستندات قانونی.
              </p>
            </div>

            {/* کارت ۳ */}
            <div className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-blue-900/30 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-900 dark:bg-blue-950/80 dark:text-blue-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">تحلیل اسناد و پرونده‌ها</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                آپلود اسکن اوراق قضایی یا بندهای قرارداد جهت بررسی ریسک‌ها، تعهدات ناخواسته و نقاط ضعف طرف مقابل.
              </p>
            </div>

            {/* کارت ۴ */}
            <div className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-blue-900/30 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-900 dark:bg-blue-950/80 dark:text-blue-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">جستجوی دقیق در قوانین کشور</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                دسترسی فوری به متون پالایش‌شده قوانین مدنی، تجارت، مجازات، آیین دادرسی، کار و بخشنامه‌های اقتصادی.
              </p>
            </div>

            {/* کارت ۵ */}
            <div className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-blue-900/30 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-900 dark:bg-blue-950/80 dark:text-blue-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">تشخیص دادگاه صالح و مهلت‌ها</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                تعیین دقیق مرجع رسیدگی (دادگاه عمومی، دادگاه صلح یا شورای حل اختلاف) و اعلام مهلت‌های حیاتی تجدیدنظر.
              </p>
            </div>

            {/* کارت ۶ */}
            <div className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-blue-900/30 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-900 dark:bg-blue-950/80 dark:text-blue-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">راهنمای خسارت تأخیر تأدیه</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                توضیح شرایط و روش محاسبه خسارت تأخیر چک و مطالبات مالی بر پایه شاخص تورم رسمی بانک مرکزی.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* بخش اعتمادسازی و شفافیت حقوقی */}
      <section className="border-y border-slate-200/80 bg-slate-100/50 py-16 dark:border-slate-800/80 dark:bg-slate-900/50">
        <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/60 p-6 sm:p-8 dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 text-amber-600 dark:text-amber-400">
                <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  شفافیت و تعهد حرفه‌ای به اصول حقوقی
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  سامانه قاضی هوشمند یک ابزار ارتقادهنده دانش حقوقی و تسهیل‌کننده دادرسی است. تمامی اطلاعات ارائه‌شده بر مبنای مواد صریح قوانین جاری و آرا استخراج می‌شود، اما به هیچ عنوان جایگزین وکالت در دادگاه و دفاع حضوری در برابر قاضی پرونده نیست. برای پرونده‌های دارای ریسک مالی یا کیفری بالا، همواره توصیه می‌شود پس از دریافت راهنمایی اولیه از سامانه، با وکیل دادگستری مشورت فرمایید.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* پرسش‌های متداول */}
      <section className="py-20">
        <div className="container mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-xs font-bold uppercase tracking-wider text-blue-900 dark:text-amber-400">
              پاسخ به ابهامات شما
            </h2>
            <p className="mt-2 text-2xl font-black text-slate-900 sm:text-3xl dark:text-white">
              پرسش‌های متداول کاربران
            </p>
          </div>

          <div className="space-y-4">
            <details className="group rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <summary className="flex cursor-pointer items-center justify-between font-bold text-slate-900 dark:text-white">
                <span>آیا پاسخ‌های قاضی هوشمند در مراجع قضایی قابل استناد است؟</span>
                <span className="transition group-open:rotate-180">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                پاسخ‌های سامانه همواره مستند به شماره مواد صریح و تبصره‌های قوانین معتبر جمهوری اسلامی ایران است. پیش از استفاده در لایحه یا دادخواست، متن ماده را در منبع رسمی بررسی کنید یا با وکیل مشورت کنید.
              </p>
            </details>

            <details className="group rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <summary className="flex cursor-pointer items-center justify-between font-bold text-slate-900 dark:text-white">
                <span>آیا اطلاعات و فایل‌های بارگذاری‌شده من محرمانه می‌ماند؟</span>
                <span className="transition group-open:rotate-180">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                ارتباط با سایت رمزنگاری‌شده (HTTPS) است. برای پاسخ‌گویی، متن پرسش به سرویس‌دهنده مدل هوش مصنوعی ارسال می‌شود؛ جزئیات در صفحه{' '}
                <Link href="/privacy" className="font-semibold text-blue-900 hover:underline dark:text-amber-400">
                  حریم خصوصی
                </Link>{' '}
                آمده است.
              </p>
            </details>

            <details className="group rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <summary className="flex cursor-pointer items-center justify-between font-bold text-slate-900 dark:text-white">
                <span>تفاوت قاضی هوشمند با هوش مصنوعی‌های عمومی (مانند ChatGPT) چیست؟</span>
                <span className="transition group-open:rotate-180">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                هوش مصنوعی‌های عمومی قوانین ایران را به درستی نمی‌شناسند و اغلب شماره مواد جعلی یا منسوخ می‌سازند. قاضی هوشمند از موتور جستجوی دقیق روی متن منقح بیش از ۵,۷۰۰ ماده قانون و آرای وحدت رویه بهره می‌برد.
              </p>
            </details>

            <details className="group rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <summary className="flex cursor-pointer items-center justify-between font-bold text-slate-900 dark:text-white">
                <span>آیا استفاده از سامانه هزینه دارد؟</span>
                <span className="transition group-open:rotate-180">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                طرح سؤالات حقوقی اولیه و جستجو در مواد قانون رایگان است. برای نگارش لوایح دفاعیه تخصصی، بررسی پرونده‌های چندصفحه‌ای و بسته‌های اداری، اشتراک‌های مقرون‌به‌صرفه تعریف شده است.
              </p>
            </details>
          </div>
        </div>
      </section>

      {/* بنر اقدام نهایی */}
      <section className="bg-blue-900 py-16 text-white dark:bg-blue-950">
        <div className="container mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-2xl font-black sm:text-4xl">
            همین حالا پرسش حقوقی خود را بپرسید
          </h2>
          <p className="mt-4 text-sm sm:text-base text-blue-100">
            در کمتر از چند ثانیه، راهکار قانونی، مواد مرتبط و مراحل پیگیری پرونده خود را دریافت کنید.
          </p>
          <div className="mt-8">
            <Link
              href="/chat"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-8 py-4 text-base font-bold text-slate-950 shadow-lg transition-all hover:bg-amber-400"
            >
              شروع گفتگوی رایگان با قاضی هوشمند
            </Link>
          </div>
        </div>
      </section>

      {/* پاورقی */}
      <footer className="border-t border-slate-200 bg-white py-12 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 dark:text-white">سامانه قاضی هوشمند</span>
              <span>— پلتفرم تخصصی هوش مصنوعی قوانین و دادرسی ایران</span>
            </div>
            <div className="flex items-center gap-6">
              <Link href="/privacy" className="hover:underline">حریم خصوصی</Link>
              <Link href="/terms" className="hover:underline">شرایط استفاده</Link>
              <Link href="/contact" className="hover:underline">تماس و پشتیبانی</Link>
            </div>
          </div>
          <div className="mt-6 border-t border-slate-100 pt-6 text-center text-xs text-slate-500 dark:border-slate-900">
            تمامی حقوق مادی و معنوی متعلق به سامانه قاضی هوشمند است. استفاده از محتوا با ذکر منبع بلامانع است.
          </div>
        </div>
      </footer>
    </div>
  );
}
