import type { Metadata } from "next";
import Link from "next/link";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export const metadata: Metadata = {
  title: "تماس با ما و پشتیبانی | سامانه هوشمند قاضی هوشمند",
  description:
    "راه‌های ارتباط مستقیم با واحد پشتیبانی حقوقی و فنی سامانه قاضی هوشمند، شماره پشتیبانی ۲۴ ساعته و اطلاعات رسمی اینماد.",
};

export default function ContactPage() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans" dir="rtl">
      <GhaziHeader userPhone="09129367796" isVip={true} />

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        {/* هدر بخش تماس با ما */}
        <section className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
            <span>📞</span>
            <span>مرکز ارتباط با کاربران و پشتیبانی حقوقی</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            تماس با ما و پشتیبانی سامانه قاضی هوشمند
          </h1>
          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
            تیم کارشناسان حقوقی و پشتیبانی فنی قاضی هوشمند در کلیه ساعات شبانه‌روز آماده پاسخگویی به سوالات، راهنمایی در تنظیم لوایح و بررسی بازخوردهای شما هستند.
          </p>
        </section>

        {/* کانال‌های ارتباطی */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-900/70 border border-slate-800 p-6 rounded-2xl text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-2xl mx-auto text-amber-400">
              📞
            </div>
            <h3 className="font-bold text-white text-base">تماس مستقیم ۲۴/۷</h3>
            <p className="text-xs text-slate-400">پاسخگویی مستقیم تلفنی برای کاربران عادی و مشترکین VIP</p>
            <a
              href="tel:09129367796"
              className="inline-block text-amber-400 font-mono font-bold text-base hover:underline"
            >
              09129367796
            </a>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 p-6 rounded-2xl text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-2xl mx-auto text-emerald-400">
              💬
            </div>
            <h3 className="font-bold text-white text-base">مشاوره آنلاین هوشمند</h3>
            <p className="text-xs text-slate-400">پاسخ فوری به سوالات پرونده به صورت متنی و صوتی در سامانه</p>
            <Link
              href="/chat"
              className="inline-block px-4 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-semibold hover:bg-emerald-500/30 transition-colors"
            >
              شروع گفتگوی حقوقی
            </Link>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 p-6 rounded-2xl text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-2xl mx-auto text-indigo-400">
              🛡️
            </div>
            <h3 className="font-bold text-white text-base">اعتبار رسمی اینماد</h3>
            <p className="text-xs text-slate-400">دارای نماد اعتماد الکترونیکی رسمی وزارت صمت</p>
            <span className="inline-block font-mono text-xs text-indigo-300 bg-indigo-500/10 px-3 py-1 rounded-lg border border-indigo-500/20">
              شناسه کسب‌وکار: ۷۴۹۱۴۳۹
            </span>
          </div>
        </section>

        {/* مشخصات قانونی و مالکیت سامانه */}
        <section className="bg-slate-900/60 border border-slate-800 p-6 sm:p-8 rounded-3xl space-y-4">
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <span>🏛️</span>
            <span>اطلاعات هویتی و ثبت حقوقی سامانه</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-300">
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-500 block mb-1">نام سامانه:</span>
              <span className="font-semibold text-white">سامانه هوشمند قاضی هوشمند (Ghazihoushmand)</span>
            </div>
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-500 block mb-1">مدیریت سامانه:</span>
              <span className="font-semibold text-white">آقای ماهان محمدی</span>
            </div>
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-500 block mb-1">حوزه فعالیت:</span>
              <span>ارائه خدمات پردازش و استخراج هوشمند قوانین و لوایح دادرسی</span>
            </div>
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-500 block mb-1">نحوه ارتباط فوری:</span>
              <span className="font-mono text-amber-400">09129367796 (پاسخگویی مستقیم)</span>
            </div>
          </div>
        </section>
      </main>

      <EnamadFooter />
    </div>
  );
}
