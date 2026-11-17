"use client";

import Link from "next/link";
import { Mail, Phone, ShieldCheck } from "lucide-react";

import { EnamadBadge } from "@/components/layout/EnamadBadge";
import { useTranslations } from "next-intl";

const PLATFORM_LINKS = [
  { href: "/accounting", label: "حسابداری دوطرفه" },
  { href: "/invoicing", label: "صورتحساب و مالیات" },
  { href: "/inventory", label: "انبار و موجودی" },
  { href: "/crm", label: "مدیریت مشتریان (CRM)" },
  { href: "/hr", label: "منابع انسانی و حقوق" },
  { href: "/signup", label: "ثبت‌نام" },
  { href: "/login", label: "ورود" },
  { href: "/contact", label: "تماس" },
];

/**
 * فوتر رسمی پورتال سازمانی روکسیرا (roxira.ir).
 *
 * شامل نماد اعتماد الکترونیکی اختصاصی روکسیرا (اینماد کد ۷۴۸۰۵۵۹)، اطلاعات
 * تماس رسمی و پیوندهای دسترسی سریع به ماژول‌های سازمانی، انطباق مالیاتی و
 * کارخانه نرم‌افزار خودمختار. توجه: طبق اعلام رسمی سامانه اینماد، صفت
 * rel="noopener noreferrer" نباید در تگ <a> نماد اعتماد وجود داشته باشد.
 */
export function RoxiraFooter() {
    const t = useTranslations('layout');
  return (
    <footer className="border-t border-white/10 bg-[#020617] text-slate-400">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="space-y-4 md:col-span-1">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-base font-black text-white shadow-lg shadow-indigo-600/30">
              R
            </span>
            <div>
              <div className="text-sm font-bold text-white">{t('roxira-footer.864fa78a')}</div>
              <div className="font-mono text-[10px] text-slate-500" dir="ltr">
                Roxira
              </div>
            </div>
          </div>
          <p className="text-xs leading-relaxed">
            {t('roxira-footer.c76a7cf7')}</p>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-bold text-white">{t('roxira-footer.a9ed4981')}</h4>
          <ul className="space-y-2 text-xs">
            {PLATFORM_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="transition-colors hover:text-indigo-300">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-bold text-white">{t('roxira-footer.396c3a9c')}</h4>
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
          </ul>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-bold text-white">{t('roxira-footer.5c5b321f')}</h4>
          <div>
            <EnamadBadge domain="roxira" />
            <span className="mt-2 flex items-center gap-1 text-[10px] font-bold text-slate-500">
              <ShieldCheck className="size-3 text-emerald-400" />
              {t('roxira-footer.a278ac44')}</span>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-center text-[11px] text-slate-500 sm:flex-row sm:px-6 sm:text-right">
          <span>{t('roxira-footer.ff610371')}</span>
          <span className="font-mono" dir="ltr">
            <a href="https://roxira.ir" className="transition-colors hover:text-indigo-300">
              roxira.ir
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
