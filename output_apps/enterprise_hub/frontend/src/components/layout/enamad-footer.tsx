"use client";
import Link from "next/link";
import { Scale, ShieldCheck } from "lucide-react";

import {
  ENAMAD_REFERRER_ATTRIBUTE,
  EnamadBadge,
  enamadTrustUrl,
} from "@/components/layout/EnamadBadge";

interface EnamadFooterProps {
  compact?: boolean;
}

export function EnamadFooter({ compact = false }: EnamadFooterProps) {
  return (
    <footer className="glass-surface w-full text-muted-foreground text-xs mt-auto select-none" dir="rtl">
      {compact ? (
        /* نسخه فشرده تک‌خطی مخصوص /chat و /judge: فقط نقطه وضعیت + نماد اینماد.
           سایر پیوندها در منوی همبرگری هدر موجودند. */
        <div className="max-w-6xl mx-auto px-4 py-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2">
            <span className="w-2 h-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
            <span className="truncate font-medium text-foreground/80">قاضی هوشمند | دستیار تخصصی دادرسی و ادله</span>
          </div>

          {/* نماد اینماد: بدون rel و بدون target تا مرورگر ارجاع (referrer) را حذف نکند */}
          <a
            {...ENAMAD_REFERRER_ATTRIBUTE}
            href={enamadTrustUrl("ghazi")}
            className="flex shrink-0 cursor-pointer items-center gap-1 font-medium text-emerald-400 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
          >
            <ShieldCheck className="size-3.5" />
            <span>اینماد 7491439</span>
          </a>
        </div>
      ) : (
        /* نسخه کامل با تمام بکلینک‌های سئو و نماد اعتماد */
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-xs border-b border-border/80 pb-6">
            {/* ستون 1: معرفی سامانه */}
            <div className="space-y-2 md:col-span-2">
              <div className="flex items-center gap-2">
                <Scale className="size-4 text-amber-400" />
                <span className="font-bold text-foreground text-sm">سامانه هوشمند قاضی هوشمند</span>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed max-w-md">
                اولین پلتفرم بومی پردازش زبان حقوقی، استخراج ادله اثبات دعوی و انشای لوایح مستند به 5,184 گره تنقیح‌شده قوانین و آرای دیوان عالی کشور بر پایه معماری Dual-Level GraphRAG.
              </p>
              <div className="pt-1 flex items-center gap-2 text-muted-foreground text-[11px]">
                <span>پشتیبانی شبانه‌روزی:</span>
                <a href="tel:09129367796" className="text-amber-400 font-mono font-bold hover:underline">09129367796</a>
              </div>
            </div>

            {/* ستون 2: دسترسی سریع و بکلینک‌ها */}
            <div className="space-y-2">
              <span className="text-foreground font-bold block text-xs">خدمات و ماژول‌ها</span>
              <ul className="space-y-1.5 text-[11px] text-muted-foreground">
                <li><Link href="/chat" className="hover:text-amber-400 transition-colors">گفتگوی دادرسی و تحلیل ادله</Link></li>
                <li><Link href="/draft-ruling" className="hover:text-amber-400 transition-colors">پیش‌نویس غیررسمی رأی (VIP)</Link></li>
                <li><Link href="/draft-indictment" className="hover:text-amber-400 transition-colors">پیش‌نویس غیررسمی کیفرخواست (VIP)</Link></li>
                <li><Link href="/services" className="hover:text-amber-400 transition-colors">طرح‌های اشتراک و مقایسه VIP</Link></li>
                <li><Link href="/technology" className="hover:text-amber-400 transition-colors">معماری فنی و گراف دانش RAG</Link></li>
                <li><Link href="/laws" className="hover:text-amber-400 transition-colors">پایگاه مواد و تنقیح قوانین</Link></li>
                <li><Link href="/coverage" className="hover:text-amber-400 transition-colors">پوشش قوانین</Link></li>
                <li><Link href="/precedents" className="hover:text-amber-400 transition-colors">آرای وحدت رویه دیوان عالی</Link></li>
              </ul>
            </div>

            {/* ستون 3: بخش حقوقی و اینماد رسمی */}
            <div className="space-y-3">
              <span className="text-foreground font-bold block text-xs">اعتبار قانونی و مجوزها</span>
              <ul className="space-y-1.5 text-[11px] text-muted-foreground">
                <li><Link href="/about" className="hover:text-amber-400 transition-colors">درباره سامانه و مدیریت</Link></li>
                <li><Link href="/contact" className="hover:text-amber-400 transition-colors">تماس با پشتیبانی رسمی</Link></li>
                <li><Link href="/terms" className="hover:text-amber-400 transition-colors">قوانین، مقررات و سلب مسئولیت</Link></li>
                <li><Link href="/privacy" className="hover:text-amber-400 transition-colors">حفظ محرمانگی اسناد و پرونده</Link></li>
              </ul>

              {/* نشان تایید اینماد — کامپوننت مشترک EnamadBadge (اینماد قاضی هوشمند، شناسه 7491439) */}
              <div className="pt-1">
                <EnamadBadge domain="ghazi" />
                <div className="mt-2 text-right text-[10px]">
                  <span className="block font-bold text-foreground/90">نماد اعتماد الکترونیکی</span>
                  <span className="font-mono text-muted-foreground">شناسه: 7491439</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span>© کلیه حقوق مادی و معنوی متعلق به سامانه هوشمند «قاضی هوشمند» است.</span>
            <div className="flex items-center gap-3">
              <Link href="/terms" className="hover:underline">شرایط استفاده</Link>
              <span>•</span>
              <Link href="/privacy" className="hover:underline">حفظ محرمانگی پرونده‌ها</Link>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}

export default EnamadFooter;
