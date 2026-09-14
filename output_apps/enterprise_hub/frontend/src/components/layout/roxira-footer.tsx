import Link from "next/link";
import { Mail, MapPin, Phone, ShieldCheck } from "lucide-react";

const QUICK_LINKS = [
  { href: "/invoicing", label: "سامانه فاکتور الکترونیک" },
  { href: "/damages", label: "محاسبه‌گر خسارت تاخیر تادیه" },
  { href: "/judge", label: "دستیار حقوقی سازمانی" },
  { href: "/docs", label: "مستندات وب‌سرویس و API" },
];

const MODULES = [
  { href: "/invoicing", label: "صدور صورتحساب" },
  { href: "/damages", label: "محاسبات رسمی" },
  { href: "/judge", label: "پایگاه دانش" },
  { href: "/docs", label: "درگاه توسعه‌دهندگان" },
];

/**
 * فوتر رسمی پورتال سازمانی روکسیرا (roxira.ir).
 *
 * شامل نماد اعتماد الکترونیکی اختصاصی روکسیرا (اینماد کد ۷۴۸۰۵۵۹)، اطلاعات
 * تماس رسمی، پیوندهای دسترسی سریع به ماژول‌ها و حقوق مالکیت معنوی شرکت.
 * توجه: طبق اعلام رسمی سامانه اینماد، صفت rel="noopener noreferrer" نباید در تگ <a> وجود داشته باشد تا اعتبارسنجی ارجاع‌دهنده کار کند.
 */
export function RoxiraFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#020617] text-slate-400">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="space-y-4 md:col-span-1">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-base font-black text-white shadow-lg shadow-indigo-600/30">
              R
            </span>
            <div>
              <div className="text-sm font-bold text-white">رکسایرا</div>
              <div className="font-mono text-[10px] text-slate-500" dir="ltr">
                Roxira Enterprise OS
              </div>
            </div>
          </div>
          <p className="text-xs leading-relaxed">
            زیرساخت ابری یکپارچه سازمانی؛ از مدیریت اسناد مالیاتی و محاسبات رسمی تا
            اتصال امن به زیرساخت هوش مصنوعی و پایگاه دانش سازمانی.
          </p>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-bold text-white">دسترسی سریع</h4>
          <ul className="space-y-2 text-xs">
            {QUICK_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="transition-colors hover:text-indigo-300"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-bold text-white">تماس رسمی</h4>
          <ul className="space-y-3 text-xs">
            <li className="flex items-center gap-2">
              <Phone className="size-3.5 shrink-0 text-indigo-300" />
              <a
                href="tel:09129367796"
                dir="ltr"
                className="font-mono font-semibold text-slate-200 transition-colors hover:text-indigo-300"
              >
                0912 936 7796
              </a>
            </li>
            <li className="flex items-center gap-2">
              <Mail className="size-3.5 shrink-0 text-indigo-300" />
              <a
                href="mailto:info@roxira.ir"
                dir="ltr"
                className="font-mono text-slate-200 transition-colors hover:text-indigo-300"
              >
                info@roxira.ir
              </a>
            </li>
            <li className="flex items-start gap-2 leading-relaxed">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-indigo-300" />
              <span>
                تهران، فرمانیه، خیابان سعیدی، بن‌بست گلریز، پلاک ۱، واحد ۵
              </span>
            </li>
          </ul>
          <nav className="flex flex-wrap gap-x-4 gap-y-2 pt-1 text-xs">
            {MODULES.map((module) => (
              <Link
                key={module.href}
                href={module.href}
                className="transition-colors hover:text-indigo-300"
              >
                {module.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex flex-col items-center justify-center gap-2 md:items-end">
          <div className="inline-block rounded-2xl border border-white/10 bg-white p-2.5 shadow-lg">
            <a
              referrerPolicy="origin"
              target="_blank"
              href="https://trustseal.enamad.ir/?id=7480559&Code=y8CR7EIrUfh4ZL897SvEy6SCJPlf5bBp"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                referrerPolicy="origin"
                src="https://trustseal.enamad.ir/logo.aspx?id=7480559&Code=y8CR7EIrUfh4ZL897SvEy6SCJPlf5bBp"
                alt="نماد اعتماد الکترونیکی رکسایرا"
                className="h-auto w-24 cursor-pointer"
                id="y8CR7EIrUfh4ZL897SvEy6SCJPlf5bBp"
                style={{ cursor: "pointer" }}
              />
            </a>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
            <ShieldCheck className="size-3 text-emerald-400" />
            نماد اعتماد الکترونیکی رسمی روکسیرا — کد ۷۴۸۰۵۵۹
          </span>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-center text-[11px] text-slate-500 sm:flex-row sm:px-6 sm:text-right">
          <span>© ۱۴۰۵ رکسایرا — تمامی حقوق مادی و معنوی محفوظ است.</span>
          <span className="flex items-center gap-3 font-mono" dir="ltr">
            <a href="https://roxira.ir" className="transition-colors hover:text-indigo-300">
              roxira.ir
            </a>
            <span className="text-slate-700">·</span>
            <a
              href="https://ghazihoushmand.ir"
              className="transition-colors hover:text-indigo-300"
            >
              ghazihoushmand.ir
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
