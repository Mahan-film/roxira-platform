import type { Metadata } from "next";
import Link from "next/link";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export const metadata: Metadata = {
  title: "معماری و تکنولوژی هوش مصنوعی | سامانه هوشمند قاضی هوشمند",
  description:
    "آشنایی با زیرساخت فنی، معماری Dual-Level GraphRAG (LightRAG)، پایگاه داده برداری Qdrant و گراف دانش ۵٬۱۸۴ گره حقوقی سامانه قاضی هوشمند.",
};

export default function TechnologyPage() {
  const techStack = [
    {
      icon: "🧠",
      title: "معماری Dual-Level GraphRAG",
      desc: "ترکیب استخراج برداری متراکم با گراف دانش پویای موجودیت‌ها و روابط حقوقی ایران بر پایه LightRAG و موتور پردازش اسناد Docling جهت استخراج دقیق ادله اثبات دعوی و تفکیک مواد حاکم از منسوخ.",
    },
    {
      icon: "⚡",
      title: "موتور استدلال چندمدلی (Multi-Model AI)",
      desc: "بهره‌گیری هماهنگ از قوی‌ترین مدل‌های استنتاج عمیق نسل جدید (Claude 5 Sonnet، DeepSeek V4.1 Reasoning و Gemini 3.8 Flash) برای نگارش پیش‌نویس لوایح اعاده دادرسی دیوان عالی و دادخواست‌های بدوی.",
    },
    {
      icon: "🗄️",
      title: "پایگاه برداری Qdrant & پایگاه داده PostgreSQL",
      desc: "ذخیره امبدینگ‌های معنایی متن کامل ۵٬۱۸۴ ماده قانونی و آرای وحدت رویه در کنار پایگاه رابطه‌ای امن برای بازیابی با تأخیر کمتر از ۶۰ میلی‌ثانیه.",
    },
    {
      icon: "🎙️",
      title: "خط‌لوله صوتی بلادرنگ (Real-Time Voice Streaming)",
      desc: "پروتکل وب‌سوکت دوطرفه بر بستر WSS برای استریم مستقیم بافرهای صوتی، پیاده‌سازی گفتار به متن فارسی با مدل‌های چندوجهی و سنتز پاسخ صوتی بدون تأخیر.",
    },
    {
      icon: "⚖️",
      title: "پایگاه تنقیح قوانین و آرای وحدت رویه",
      desc: "پایش بلادرنگ تغییرات قوانین سال ۱۴۰۲ و ۱۴۰۳ به‌ویژه قواعد قانون جدید دادگاه‌های صلح، قانون شورای حل اختلاف و آراء اصراری و هیأت عمومی دیوان عالی کشور.",
    },
    {
      icon: "🔒",
      title: "ایزولاسیون و رمزنگاری داده‌های پرونده",
      desc: "جداسازی کامل حافظه جلسات مراجعین با الگوریتم Mem0، عدم استفاده از مستندات پرونده برای آموزش عمومی مدل‌ها و امحای نشست‌ها مطابق استانداردهای GDPR.",
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
            سامانه قاضی هوشمند بر پایه به‌روزترین معماری‌های RAG و مدل‌های پردازش زبان حقوقی توسعه یافته تا خطای توهم (Hallucination) مدل‌های زبانی به صفر میل کند و استنادها صددرصد منطبق با مراجع قضایی رسمی باشند.
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
            <span>مکانیزم استدلال دو‌سطحی (Dual-Level GraphRAG) چگونه کار می‌کند؟</span>
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
