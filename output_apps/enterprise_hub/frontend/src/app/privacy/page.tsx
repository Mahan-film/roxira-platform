import type { Metadata } from "next";
import Link from "next/link";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export const metadata: Metadata = {
  title: "حریم خصوصی | سامانه هوشمند قاضی هوشمند",
  description:
    "سیاست‌نامه و پروتکل‌های محرمانگی اطلاعات، حفاظت از داده‌های پرونده‌های قضایی و امنیت کاربران در سامانه قاضی هوشمند.",
};

export default function PrivacyPage() {
  return (
    <div className="dark glass-app-bg flex flex-col min-h-screen text-foreground font-sans" dir="rtl">
      <GhaziHeader />

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <section className="space-y-3 text-center sm:text-right">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
            <span>🔒</span>
            <span>امنیت و رازداری اطلاعات</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">سیاست حفظ حریم خصوصی</h1>
          <p className="text-xs sm:text-sm text-slate-400">
            تعهد ما به حفاظت کامل از محرمانگی پرونده‌ها و اسناد حقوقی مراجعین محترم.
          </p>
        </section>

        <div className="space-y-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <h2 className="text-sm sm:text-base font-bold text-amber-400">۱. اصل محرمانگی اسناد و پرونده‌های حقوقی</h2>
            <p>
              ما در سامانه قاضی هوشمند به اهمیت بنیادین رازداری در امور وکالتی و پرونده‌های قضایی واقفیم. متن دعاوی، دادخواست‌ها، فایل‌ها و مکالمات صوتی ثبت‌شده توسط کاربران منحصراً جهت پردازش توسط مدل استنتاجی و ارائه لایحه مربوط به همان نشست استفاده می‌گردد و به هیچ عنوان برای آموزش عمومی مدل‌ها یا اشتراک با اشخاص ثالث استفاده نخواهد شد.
            </p>
          </article>

          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <h2 className="text-sm sm:text-base font-bold text-amber-400">۲. امنیت انتقال و ذخیره‌سازی اطلاعات</h2>
            <p>
              کلیه تبادلات داده‌ای میان مرورگر شما و سرورهای سامانه قاضی هوشمند از طریق پروتکل‌های رمزنگاری پیشرفته (SSL / TLS 1.3) محافظت می‌شوند. بافرهای صوتی استریم نیز در بستر سوکت‌های امن رمزگذاری شده و پس از تحلیل بلادرنگ در حافظه موقت، بر اساس اصول امنیتی پالایش می‌گردند.
            </p>
          </article>

          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <h2 className="text-sm sm:text-base font-bold text-amber-400">۳. اطلاعات هویتی و شماره‌های تماس</h2>
            <p>
              شماره تلفن‌های همراه ثبت‌شده در سامانه (جهت دریافت کد تایید ورود پیامکی Kavenegar و تخصیص سهمیه‌های کاربری) به صورت ایمن نگهداری می‌شوند. این اطلاعات صرفاً جهت احراز هویت قانونی، فعال‌سازی اشتراک‌های ویژه و ارائه خدمات پشتیبانی مورد استفاده قرار می‌گیرند.
            </p>
          </article>

          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <h2 className="text-sm sm:text-base font-bold text-amber-400">۴. حقوق کاربران و پشتیبانی امنیتی</h2>
            <p>
              کاربران در هر زمان حق دارند درخواست پاکسازی تاریخچه گفتگوها و سوابق پرونده‌های ثبت‌شده خود را از طریق ارتباط مستقیم با پشتیبانی به شماره <a href="tel:09129367796" className="text-amber-400 font-mono font-bold">09129367796</a> اعلام نمایند.
            </p>
          </article>
        </div>

        <div className="text-center pt-4">
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs sm:text-sm transition-colors"
          >
            <span>بازگشت به محیط مشاوره قاضی هوشمند</span>
            <span>⚖️</span>
          </Link>
        </div>
      </main>

      <EnamadFooter />
    </div>
  );
}
