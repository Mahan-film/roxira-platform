import { Mail, Phone, Scale } from "lucide-react";

/**
 * فوتر رسمی سامانه قاضی هوشمند (ghazihoushmand.ir)
 * شامل نماد اعتماد الکترونیکی (eNamad)، شماره تماس پشتیبانی و قوانین سامانه.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-white/5 bg-[#080C16] px-4 py-10 text-xs text-slate-400 sm:px-6">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 md:grid-cols-3">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400/20 to-amber-600/10 ring-1 ring-amber-400/20">
              <Scale className="size-4 text-amber-300" />
            </span>
            <span className="text-sm font-bold text-slate-100">سامانه قاضی هوشمند</span>
          </div>
          <p className="leading-relaxed">
            دستیار حقوقی هوشمند برای تحلیل ادله دادرسی، استعلام رویه قضایی و انشای لوایح محاکم ایران.
          </p>
          <p className="font-mono text-[11px] text-slate-500" dir="ltr">
            ghazihoushmand.ir — 2026
          </p>
        </div>

        <div className="space-y-3">
          <h4 className="font-bold text-slate-100">ارتباط با پشتیبانی</h4>
          <p className="flex items-center gap-2">
            <Phone className="size-3.5 text-amber-300" />
            <a
              href="tel:09129367796"
              dir="ltr"
              className="font-mono font-semibold text-slate-200 transition-colors hover:text-amber-300"
            >
              0912 936 7796
            </a>
          </p>
          <p className="flex items-center gap-2">
            <Mail className="size-3.5 text-amber-300" />
            <a
              href="mailto:info@ghazihooshmand.ir"
              dir="ltr"
              className="font-mono text-slate-200 transition-colors hover:text-amber-300"
            >
              info@ghazihooshmand.ir
            </a>
          </p>
          <nav className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            <a href="#terms" className="transition-colors hover:text-amber-300">
              قوانین و مقررات
            </a>
            <a href="#privacy" className="transition-colors hover:text-amber-300">
              حریم خصوصی
            </a>
            <a href="#usage" className="transition-colors hover:text-amber-300">
              شرایط استفاده
            </a>
          </nav>
        </div>

        <div className="flex flex-col items-center justify-center md:items-end">
          <div className="inline-block rounded-2xl border border-white/10 bg-white p-2.5 shadow-lg">
            <a
              referrerPolicy="origin"
              target="_blank"
              rel="noopener noreferrer"
              href="https://trustseal.enamad.ir/?id=7491439&Code=yFeNLueqB3RV5ZK9nT7avRH3IR8jSeYa"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                referrerPolicy="origin"
                src="https://trustseal.enamad.ir/logo.aspx?id=7491439&Code=yFeNLueqB3RV5ZK9nT7avRH3IR8jSeYa"
                alt="نماد اعتماد الکترونیکی"
                className="h-auto w-24 cursor-pointer"
              />
            </a>
          </div>
          <span className="mt-2 text-[10px] font-bold text-slate-500">
            نماد اعتماد الکترونیکی قضایی
          </span>
        </div>
      </div>

      <div className="mx-auto mt-8 w-full max-w-5xl border-t border-white/5 pt-4 text-center text-[11px] text-slate-500">
        © ۱۴۰۵ — تمامی حقوق برای سامانه قاضی هوشمند محفوظ است.
      </div>
    </footer>
  );
}
