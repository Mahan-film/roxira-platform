import type { Metadata } from "next";
import Link from "next/link";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";
import { SubscriptionCta } from "@/components/judge/subscription/subscription-cta";

const SERVICES_TITLE = "محصولات، خدمات و تعرفه اشتراک | سامانه هوشمند قاضی هوشمند";
const SERVICES_DESCRIPTION =
  "آشنایی با محصولات، خدمات تخصصی و مقایسه طرح رایگان با اشتراک نامحدود VIP در سامانه هوشمند قاضی هوشمند.";

export const metadata: Metadata = {
  title: SERVICES_TITLE,
  description: SERVICES_DESCRIPTION,
  alternates: { canonical: "https://ghazihoushmand.ir/services" },
  openGraph: {
    title: SERVICES_TITLE,
    description: SERVICES_DESCRIPTION,
    url: "https://ghazihoushmand.ir/services",
    siteName: "قاضی هوشمند",
    locale: "fa_IR",
    type: "website",
  },
};

export default function ServicesPage() {
  return (
    <div className="dark glass-app-bg flex flex-col min-h-screen text-foreground font-sans" dir="rtl">
      <GhaziHeader />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-12">
        {/* بخش عنوان */}
        <section className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium">
            <span>💎</span>
            <span>بسته‌ها و امکانات تخصصی قاضی هوشمند</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            خدمات حقوقی مبتنی بر هوش مصنوعی و پلن‌های کاربری
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl mx-auto leading-relaxed">
            سامانه قاضی هوشمند با پیاده‌سازی معماری پیشرفته Dual-Level GraphRAG، امکان استعلام مواد قانونی، تحلیل ادله اثبات دعوا و انشای لوایح دادرسی را برای کلیه مراجعین فراهم آورده است. پوشش فعلی قوانین محدود به ۸ قانون است؛ فهرست دقیق را در{" "}
            <Link href="/coverage" className="text-amber-400 hover:underline">صفحه پوشش قوانین</Link> ببینید.
          </p>
        </section>

        {/* جدول مقایسه طرح رایگان در برابر اشتراک VIP */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
          {/* کارت طرح رایگان */}
          <div className="glass-raised p-6 sm:p-8 rounded-3xl flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="px-3 py-1 bg-slate-800 text-slate-300 text-xs font-bold rounded-full">
                  طرح پایه و عمومی
                </span>
                <span className="text-xs text-slate-500">دسترسی پیش‌فرض</span>
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">طرح رایگان (Free Tier)</h3>
                <p className="text-xs text-slate-400 mt-1">
                  مناسب برای شهروندان، دانشجویان و استعلامات فوری و عمومی مواد قانونی
                </p>
              </div>

              <div className="text-2xl font-extrabold text-slate-200">
                رایگان <span className="text-xs font-normal text-slate-500">/ بدون نیاز به پرداخت</span>
              </div>

              <ul className="space-y-3 pt-4 border-t border-slate-800/80 text-xs text-slate-300">
                <li className="flex items-center gap-2.5">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>پرسش و پاسخ متنی پیرامون مواد قانون مدنی و مجازات</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>سرعت استنتاج استاندارد با مدل‌های سبک و اقتصادی</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>تایپ صوتی استاندارد (Speech-to-Text) در چت</span>
                </li>
                <li className="flex items-center gap-2.5 text-slate-500">
                  <span className="text-rose-400 font-bold">✕</span>
                  <span>مکالمه زنده صوتی (Live Voice Call)</span>
                </li>
                <li className="flex items-center gap-2.5 text-slate-500">
                  <span className="text-rose-400 font-bold">✕</span>
                  <span>انشای تخصصی لوایح اعاده دادرسی دیوان عالی (ماده ۴۷۴)</span>
                </li>
                <li className="flex items-center gap-2.5 text-slate-500">
                  <span className="text-rose-400 font-bold">✕</span>
                  <span>استدلال عمیق با قوی‌ترین مدل‌های هوش مصنوعی بین‌المللی</span>
                </li>
              </ul>
            </div>

            <Link
              href="/chat"
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-center font-bold text-xs rounded-xl transition-colors block"
            >
              استفاده از نسخه رایگان
            </Link>
          </div>

          {/* کارت طرح ویژه VIP */}
          <div className="glass-raised p-6 sm:p-8 rounded-3xl flex flex-col justify-between space-y-6 relative outline outline-2 outline-amber-500/40 shadow-2xl shadow-amber-500/10">
            {/* لایهٔ تینت طلایی روی سطح شیشه‌ای، بدون تداخل با blur/border سطح پایه */}
            <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-amber-500/15 via-transparent to-transparent" />

            <div className="absolute -top-3.5 right-6 px-3.5 py-1 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 text-xs font-black rounded-full uppercase tracking-wider shadow-md">
              ویژه وکلا، مشاوران و پرونده‌های سنگین
            </div>

            <div className="relative space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <span className="px-3 py-1 bg-amber-500/20 text-amber-400 text-xs font-bold rounded-full border border-amber-500/30">
                  VIP UNLIMITED
                </span>
                <span className="text-xs text-emerald-400 font-medium">سهمیه نامحدود</span>
              </div>

              <div>
                <h3 className="text-xl font-bold text-amber-400">اشتراک نامحدود VIP</h3>
                <p className="text-xs text-slate-400 mt-1">
                  بسته گسترده‌تر هوش مصنوعی دادرسی قضایی (پوشش قوانین محدود به ۸ قانون؛ جزئیات در صفحه پوشش قوانین) برای وکلا، کارشناسان و مراجعین ویژه
                </p>
              </div>

              <div className="text-2xl font-extrabold text-white">
                دسترسی اختصاصی <span className="text-xs font-normal text-amber-400/80">/ نامحدود</span>
              </div>

              <ul className="space-y-3 pt-4 border-t border-slate-800/80 text-xs text-slate-200">
                <li className="flex items-center gap-2.5">
                  <span className="text-amber-400 font-bold">✓</span>
                  <span><strong>انشای کامل لوایح قضایی:</strong> دادخواست‌ها، اعاده دادرسی ۴۷۴ ق.آ.د.ک و ۴۲۶ ق.آ.د.م</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="text-amber-400 font-bold">✓</span>
                  <span><strong>مکالمه صوتی زنده (Live Voice Call):</strong> تعامل بدون تاخیر با امکان مکالمه مستقیم</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="text-amber-400 font-bold">✓</span>
                  <span><strong>موتورهای استدلال عمیق:</strong> اتصال به پیشرفته‌ترین مدل‌های نسل جدید هوش مصنوعی (Claude 5 Sonnet, DeepSeek V4.1 Reasoning, Gemini 3.8 Flash)</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="text-amber-400 font-bold">✓</span>
                  <span><strong>تطبیق بلادرنگ با آراء وحدت رویه:</strong> ممیزی ادله با آخرین احکام هیأت عمومی دیوان عالی</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="text-amber-400 font-bold">✓</span>
                  <span><strong>محاسبات رسمی:</strong> تاخیر تادیه بر اساس شاخص بانک مرکزی و اجرای مستقیم چک صیادی (ماده ۲۳)</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="text-amber-400 font-bold">✓</span>
                  <span><strong>پشتیبانی اولویت‌دار اختصاصی ۲۴ ساعته</strong></span>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <SubscriptionCta
                label="خرید و فعال‌سازی اشتراک VIP"
                className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold text-center text-xs rounded-xl transition-all shadow-lg shadow-amber-500/20 block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
              />
              <a
                href="tel:09129367796"
                className="w-full py-2.5 bg-slate-900/60 hover:bg-slate-800 border border-amber-500/30 text-amber-300 font-semibold text-center text-xs rounded-xl transition-colors block"
              >
                فعال‌سازی تلفنی اشتراک VIP (تماس با 09129367796)
              </a>
              <p className="text-[10px] text-center text-slate-500">
                کاربران دارای اشتراک فعال به محض احراز هویت با شماره همراه خود به کلیه قابلیت‌ها دسترسی دارند.
              </p>
            </div>
          </div>
        </section>

        {/* محصولات و ماژول‌های تخصصی سامانه */}
        <section className="bg-slate-900/50 border border-slate-800 p-6 sm:p-8 rounded-3xl space-y-6">
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <span>⚙️</span>
            <span>ماژول‌ها و ابزارهای تخصصی سامانه قاضی هوشمند</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-4 bg-slate-950/70 border border-slate-800/80 rounded-2xl space-y-2">
              <span className="text-amber-400 font-bold text-sm block">۱. موتور انشای اعاده دادرسی</span>
              <p className="text-slate-400 leading-relaxed">
                تنظیم استاندارد لایحه تجویز اعاده دادرسی کیفری منطبق با بندهای هفت‌گانه ماده ۴۷۴ و استخراج مغایرت‌های بین بیّن با موازین شرعی و قانونی (ماده ۴۷۷).
              </p>
            </div>

            <div className="p-4 bg-slate-950/70 border border-slate-800/80 rounded-2xl space-y-2">
              <span className="text-emerald-400 font-bold text-sm block">۲. تریاژ صلاحیت محاکم و دادگاه صلح</span>
              <p className="text-slate-400 leading-relaxed">
                تفکیک دعاوی مالی تا سقف یک میلیارد ریال جهت ارجاع به دادگاه صلح بر اساس ماده ۱۲ قانون شوراهای حل اختلاف ۱۴۰۲ و جلوگیری از صدور قرار عدم صلاحیت.
              </p>
            </div>

            <div className="p-4 bg-slate-950/70 border border-slate-800/80 rounded-2xl space-y-2">
              <span className="text-indigo-400 font-bold text-sm block">۳. دستیار صوتی بلادرنگ (Live Voice)</span>
              <p className="text-slate-400 leading-relaxed">
                امکان طرح شرح دعوا از طریق مکالمه طبیعی صوتی و دریافت پاسخ استدلالی با کُدک‌های صوتی سازگار با تلفن همراه و مرورگرهای مدرن.
              </p>
            </div>
          </div>
        </section>

        {/* بخش اعتماد و مجوز */}
        <section className="border-t border-slate-800 pt-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400">✓</span>
            <span>دارای نماد اعتماد الکترونیکی معتبر از وزارت صنعت، معدن و تجارت (کد ۷۴۹۱۴۳۹)</span>
          </div>
          <div>
            <span>پشتیبانی شبانه‌روزی: </span>
            <a href="tel:09129367796" className="text-amber-400 font-mono font-bold hover:underline">
              09129367796
            </a>
          </div>
        </section>
      </main>

      <EnamadFooter />
    </div>
  );
}
