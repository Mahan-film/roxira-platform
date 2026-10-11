import type { Metadata } from "next";
import Link from "next/link";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export const metadata: Metadata = {
  title: "معماری و تکنولوژی هوش مصنوعی | سامانه هوشمند قاضی هوشمند",
  description:
    "آشنایی کلی با روش کار قاضی هوشمند: بازیابی متن مواد قانونی، تولید پاسخ و محدودیت‌های آن.",
};

export default function TechnologyPage() {
  const techStack = [
    {
      icon: "🧠",
      title: "بازیابی از متن مواد قانونی",
      desc: "پیش از پاسخ، مواد مرتبط از پایگاه قوانین بارگذاری‌شده بازیابی می‌شود و پاسخ بر پایه همان متن‌ها نوشته می‌شود. این روش خطا را کم می‌کند ولی حذف نمی‌کند.",
    },
    {
      icon: "⚡",
      title: "مدل‌های زبانی",
      desc: "برای تحلیل و نگارش پیش‌نویس از مدل‌های زبانی هوش مصنوعی استفاده می‌شود. خروجی پیش‌نویس است و باید توسط وکیل یا کارشناس بازبینی شود.",
    },
    {
      icon: "🗄️",
      title: "پایگاه قوانین",
      desc: "متن قوانین بارگذاری‌شده برای جستجوی معنایی ذخیره شده است؛ تعداد قوانین و مواد در صفحه پوشش قوانین آمده است.",
    },
    {
      icon: "🎙️",
      title: "خط‌لوله صوتی بلادرنگ (Real-Time Voice Streaming)",
      desc: "گفتار شما به متن فارسی تبدیل می‌شود و پاسخ می‌تواند به‌صورت صوتی پخش شود. دقت تبدیل گفتار به کیفیت صدا بستگی دارد.",
    },
    {
      icon: "⚖️",
      title: "پایگاه تنقیح قوانین و آرای وحدت رویه",
      desc: "فهرست دقیق قوانین موجود، با تاریخ آخرین اصلاح هر قانون، در صفحه پوشش قوانین نمایش داده می‌شود؛ قوانین خارج از آن فهرست پوشش داده نمی‌شوند.",
    },
    {
      icon: "🔒",
      title: "حریم خصوصی پرونده",
      desc: "فایل‌های پرونده فقط برای تحلیل پردازش می‌شوند و برای آموزش مدل استفاده نمی‌شوند. جزئیات و مدت نگهداری در صفحه حریم خصوصی آمده است.",
    },
  ];

  return (
    <div className="dark glass-app-bg flex flex-col min-h-screen text-foreground font-sans" dir="rtl">
      <GhaziHeader />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-12">
        {/* هدر صفحه تکنولوژی */}
        <section className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold">
            <span>🔬</span>
            <span>هسته هوش مصنوعی و معماری سیستم</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            تکنولوژی‌های پیشرفته سامانه قاضی هوشمند
          </h1>
          <p className="text-sm sm:text-base text-slate-400 max-w-3xl mx-auto leading-relaxed">
            پاسخ‌ها بر پایه‌ی متن مواد قانونی بازیابی‌شده‌اند و ممکن است خطا داشته باشند؛ استنادها را با منبع رسمی تطبیق دهید.
          </p>
        </section>

        {/* کارت‌های شش‌گانه معماری */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {techStack.map((tech, idx) => (
            <div
              key={idx}
              className="bg-slate-900/70 border border-slate-800 hover:border-amber-500/40 p-6 rounded-2xl space-y-3 transition-all group"
            >
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                {tech.icon}
              </div>
              <h3 className="font-bold text-base text-white group-hover:text-amber-400 transition-colors">
                {tech.title}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {tech.desc}
              </p>
            </div>
          ))}
        </section>

        {/* تشریح لایه‌های RAG دو سطحی */}
        <section className="bg-slate-900/60 border border-slate-800 p-6 sm:p-8 rounded-3xl space-y-6">
          <h2 className="text-lg sm:text-xl font-bold text-amber-400 flex items-center gap-2">
            <span>📐</span>
            <span>پاسخ‌ها چگونه تولید می‌شوند؟</span>
          </h2>
          <div className="space-y-4 text-xs sm:text-sm text-slate-300 leading-relaxed">
            <p>
              در سامانه‌های سنتی چت‌بات، مدل‌های هوش مصنوعی صرفاً بر اساس حافظه پارامتریک خود به سوالات پاسخ می‌دهند که این امر در امور حقوقی و قضایی به دلیل وجود استثنائات، مواد منسوخ و آراء متناقض وحدت رویه بسیار خطرناک است.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-amber-400 font-bold block mb-1">سطح پایین (Low-Level Retrieval):</span>
                استخراج مستقیم مواد عینی قانون، تبصره‌ها، نصاب‌های ریالی صلاحیت دادگاه صلح و متن منقح آرای وحدت رویه هیأت عمومی دیوان عالی.
              </div>
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-emerald-400 font-bold block mb-1">سطح بالا (High-Level Retrieval):</span>
                استخراج دکترین‌های حاکم، ارتباط بین آیین دادرسی مدنی و کیفری، قواعد ماهوی خسارت دادرسی و تدوین استراتژی دفاعی منسجم.
              </div>
            </div>
          </div>
        </section>

        {/* دکمه‌های ناوبری سریع */}
        <section className="text-center py-4 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/chat"
            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs sm:text-sm transition-all shadow-lg shadow-amber-500/20"
          >
            آزمودن هوش مصنوعی در چت دادرسی 💬
          </Link>
          <Link
            href="/services"
            className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 font-medium rounded-xl text-xs sm:text-sm transition-colors"
          >
            مشاهده طرح‌های اشتراک و مقایسه VIP
          </Link>
          <Link
            href="/about"
            className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 font-medium rounded-xl text-xs sm:text-sm transition-colors"
          >
            درباره پایگاه دانش و تیم توسعه
          </Link>
        </section>
      </main>

      <EnamadFooter />
    </div>
  );
}
