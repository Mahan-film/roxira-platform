import type { Metadata } from "next";
import Link from "next/link";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

const ABOUT_TITLE = "درباره ما | سامانه هوشمند قاضی هوشمند";
const ABOUT_DESCRIPTION =
  "آشنایی با سامانه هوشمند قاضی هوشمند؛ اولین پلتفرم تخصصی تحلیل دعاوی، استخراج ادله اثبات دعوی و انشای لوایح قضایی مبتنی بر هوش مصنوعی و پایگاه تنقیح قوانین ایران.";

export const metadata: Metadata = {
  title: ABOUT_TITLE,
  description: ABOUT_DESCRIPTION,
  alternates: { canonical: "https://ghazihoushmand.ir/about" },
  openGraph: {
    title: ABOUT_TITLE,
    description: ABOUT_DESCRIPTION,
    url: "https://ghazihoushmand.ir/about",
    siteName: "قاضی هوشمند",
    locale: "fa_IR",
    type: "website",
  },
};

export default function AboutPage() {
  return (
    <div className="dark glass-app-bg flex flex-col min-h-screen text-foreground font-sans" dir="rtl">
      <GhaziHeader />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        {/* هدر بخش درباره ما */}
        <section className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium">
            <span>⚖️</span>
            <span>درباره سامانه تخصصی قاضی هوشمند</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            هوشمندسازی دادرسی، تحلیل ادله و انشای لوایح قضایی
          </h1>
          <p className="text-sm sm:text-base text-slate-400 max-w-3xl mx-auto leading-relaxed">
            سامانه «قاضی هوشمند» یک بستر مستقل و پیشرفته مبتنی بر هوش مصنوعی مولد حقوقی و پایگاه داده‌های گرافی قوانین است که با هدف ارتقای دسترسی عمومی و کارشناسی به تحلیل‌های مستند، رویه‌های قضایی و استخراج ادله اثبات دعوی راه‌اندازی گردیده است.
          </p>
        </section>

        {/* سه ستون ارزش‌های محوری */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-900/70 border border-slate-800 p-6 rounded-2xl space-y-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-lg">
              📚
            </div>
            <h3 className="font-bold text-base text-white">پایگاه دانش جامع و تنقیح‌شده</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              اتصال بلادرنگ به بیش از ۵٬۱۸۴ گره حقوقی شامل قانون مدنی، مجازات اسلامی، آیین دادرسی مدنی و کیفری، قانون دادگاه‌های صلح ۱۴۰۲ و کلیه آراء وحدت رویه دیوان عالی کشور.
            </p>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 p-6 rounded-2xl space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-lg">
              ⚡
            </div>
            <h3 className="font-bold text-base text-white">معماری پیشرفته Dual-Level GraphRAG</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              تلفیق جستجوی برداری متراکم با گراف روابط مواد قانونی در پایگاه داده جهت تفکیک دقیق استثنائات، مواد منسوخ و مراجع صالح رسیدگی با کمترین زمان پاسخ‌دهی.
            </p>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 p-6 rounded-2xl space-y-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 text-lg">
              🎙️
            </div>
            <h3 className="font-bold text-base text-white">تعامل زنده متنی و صوتی (Live Voice)</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              امکان گفتگوی صوتی مستقیم، تایپ صوتی با دقت بالای واژگان فارسی و ارائه استنتاج‌های ساختارمند و آماده رونوشت برای وکلا و اصحاب دعوا.
            </p>
          </div>
        </section>

        {/* بیانیه ماموریت و حیطه فعالیت */}
        <section className="bg-slate-900/50 border border-slate-800 p-6 sm:p-8 rounded-3xl space-y-6">
          <h2 className="text-lg sm:text-xl font-bold text-amber-400 flex items-center gap-2">
            <span>🛡️</span>
            <span>ماموریت و تعهد به عدالت قضایی</span>
          </h2>
          <div className="text-xs sm:text-sm text-slate-300 leading-relaxed space-y-4">
            <p>
              در دنیای پیچیده دعاوی حقوقی و کیفری، اشراف به آخرین تغییرات قوانین (نظیر صلاحیت‌های انحصاری دادگاه صلح یا قواعد جدید قانون صدور چک) و آراء وحدت رویه لازم‌الاتباع، نقشی تعیین‌کننده در سرنوشت پرونده‌ها دارد. سامانه قاضی هوشمند با به‌کارگیری قوی‌ترین موتورهای پردازش متن و استدلال عمیق، امکان تحلیل چندجانبه مستندات پرونده را در کسری از دقیقه میسر می‌سازد.
            </p>
            <p>
              توسعه این سامانه توسط پژوهشگران حوزه هوش مصنوعی و حقوق ایران با مدیریت آقای ماهان محمدی صورت پذیرفته است. کلیه زیرساخت‌ها بر بستر سرورهای اختصاصی پرسرعت مستقر بوده و حفظ صددرصدی حریم خصوصی و محرمانگی داده‌های پرونده‌های مراجعین، خط قرمز بنیادین سامانه است.
            </p>
          </div>

          <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="space-y-1">
              <span className="text-slate-500 block">مجوز و اعتبار رسمی:</span>
              <span className="text-emerald-400 font-medium">دارای نماد اعتماد الکترونیکی (اینماد اختصاصی کد ۷۴۹۱۴۳۹)</span>
            </div>
            <div className="space-y-1">
              <span className="text-slate-500 block">مرکز پاسخگویی و پشتیبانی:</span>
              <a href="tel:09129367796" className="text-amber-400 font-mono font-bold hover:underline">
                09129367796
              </a>
            </div>
          </div>
        </section>

        {/* دعوت به اقدام */}
        <section className="text-center py-6 space-y-4">
          <h3 className="text-base font-bold text-white">پرونده یا سوال حقوقی خود را همین حالا مطرح کنید</h3>
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/chat"
              className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs sm:text-sm transition-all shadow-lg shadow-amber-500/20"
            >
              ورود به گفتگوی هوشمند ⚖️
            </Link>
            <Link
              href="/services"
              className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-medium rounded-xl text-xs sm:text-sm transition-colors"
            >
              مشاهده محصولات و طرح‌های اشتراک
            </Link>
          </div>
        </section>
      </main>

      <EnamadFooter />
    </div>
  );
}
