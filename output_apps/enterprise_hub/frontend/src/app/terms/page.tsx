import type { Metadata } from "next";
import Link from "next/link";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export const metadata: Metadata = {
  title: "قوانین و مقررات | سامانه هوشمند قاضی هوشمند",
  description:
    "شرایط، قوانین و ضوابط رسمی استفاده از خدمات مشاوره و انشای حقوقی سامانه هوشمند قاضی هوشمند.",
};

export default function TermsPage() {
  return (
    <div className="dark glass-app-bg flex flex-col min-h-screen text-foreground font-sans" dir="rtl">
      <GhaziHeader />

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <section className="space-y-3 text-center sm:text-right">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium">
            <span>📜</span>
            <span>شرایط و ضوابط رسمی استفاده</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">قوانین و مقررات سامانه قاضی هوشمند</h1>
          <p className="text-xs sm:text-sm text-slate-400">
            آخرین به‌روزرسانی: شهریور ۱۴۰۵ | مطالعه و پذیرش این مقررات برای کلیه کاربران الزامی است.
          </p>
        </section>

        <div className="space-y-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
          {/* ماده ۱ */}
          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <h2 className="text-sm sm:text-base font-bold text-amber-400">ماده ۱: تعاریف و ماهیت مشورتی سامانه</h2>
            <p>
              «سامانه قاضی هوشمند» یک بستر نرم‌افزاری پردازش هوشمند متون حقوقی و مبتنی بر هوش مصنوعی مولد است که با بهره‌گیری از پایگاه داده قوانین جمهوری اسلامی ایران و آراء قضایی تنقیح‌شده، اقدام به تحلیل دادخواست، استخراج مستندات قانونی و تنظیم پیش‌نویس لوایح می‌نماید.
            </p>
            <p className="text-slate-400 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              ⚠️ <strong>سلب مسئولیت بنیادین:</strong> اطلاعات، لوایح و استنتاجات ارائه‌شده توسط این سامانه صرفاً جنبه مشورتی، تحلیلی و آموزشی داشته و به هیچ وجه به منزله صدور رأی قضایی، نظر مرجع رسمی دادرسی، یا جایگزین وکیل دادگستری در محاکم نیست. کاربران برای تصمیم‌گیری نهایی در پرونده‌های حساس باید از مشاوره وکلای پایه یک دادگستری بهره‌مند شوند.
            </p>
          </article>

          {/* ماده ۲ */}
          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <h2 className="text-sm sm:text-base font-bold text-amber-400">ماده ۲: تعهدات کاربر و استفاده منصفانه</h2>
            <ul className="list-disc list-inside space-y-2 text-slate-300">
              <li>کاربر متعهد است کلیه اطلاعات، ادله و شرح دعاوی را بر پایه واقعیت و بدون درج اطلاعات کذب یا اسناد مجعول وارد نماید.</li>
              <li>هرگونه استفاده از سامانه برای اهداف نامشروع، کلاهبرداری، فریب مراجع قضایی یا نقض حقوق اشخاص ثالث اکیداً ممنوع بوده و مسئولیت حقوقی و کیفری ناشی از آن متوجه کاربر خواهد بود.</li>
              <li>کاربران متعهد به رعایت سقف مصرف منصفانه (Fair Use Policy) بوده و هرگونه حمله سایبری، تلاش برای مهندسی معکوس، یا استخراج فله‌ای داده‌های پایگاه قوانین مستوجب پیگرد قانونی است.</li>
            </ul>
          </article>

          {/* ماده ۳ */}
          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <h2 className="text-sm sm:text-base font-bold text-amber-400">ماده ۳: قوانین اشتراک، حساب‌های کاربری و پرداخت</h2>
            <p>
              خدمات سامانه در دو سطح «طرح رایگان (محدود)» و «اشتراک ویژه VIP (نامحدود)» عرضه می‌گردد:
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-slate-300">
              <li>کاربران عادی در طرح رایگان به امکانات پایه‌ای استعلام مواد قانونی با سقف روزانه محدود دسترسی دارند.</li>
              <li>اشتراک VIP شامل استنتاج عمیق حقوقی با مدل‌های فوق‌پیشرفته، مکالمه صوتی زنده (Live Voice Call) و دسترسی به موتورهای انشای لوایح اعاده دادرسی بدون محدودیت است.</li>
              <li>کلیه پرداخت‌ها از طریق درگاه‌های پرداخت رسمی کشور و پس از تایید شناسه اینماد صورت می‌پذیرد.</li>
            </ul>
          </article>

          {/* ماده ۴ */}
          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <h2 className="text-sm sm:text-base font-bold text-amber-400">ماده ۴: مالکیت معنوی و محرمانگی</h2>
            <p>
              کلیه حقوق مادی و معنوی مربوط به الگوریتم‌ها، فرانتاند، پایگاه داده گراف RAG و نشان‌های تجاری «قاضی هوشمند» محفوظ و متعلق به توسعه‌دهندگان آن است. سامانه متعهد است متن پرونده‌ها و اطلاعات واردشده توسط مراجعین را کاملاً محرمانه تلقی نماید.
            </p>
          </article>

          {/* ماده ۵ */}
          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <h2 className="text-sm sm:text-base font-bold text-amber-400">ماده ۵: قانون حاکم و حل اختلاف</h2>
            <p>
              این شرایط و کلیه اختلافات ناشی از آن، منحصراً تابع قوانین و مقررات موضوعه جمهوری اسلامی ایران بوده و مراجع صالحه قضایی تهران، مرجع رسیدگی به هرگونه ادعای احتمالی خواهند بود.
            </p>
          </article>
        </div>

        <div className="text-center pt-4">
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs sm:text-sm transition-colors"
          >
            <span>پذیرش و بازگشت به گفتگوی حقوقی</span>
            <span>⚖️</span>
          </Link>
        </div>
      </main>

      <EnamadFooter />
    </div>
  );
}
