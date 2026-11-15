"use client";
import Link from "next/link";
import { Scale, ShieldCheck } from "lucide-react";

import {
  ENAMAD_REFERRER_ATTRIBUTE,
  EnamadBadge,
  enamadTrustUrl,
} from "@/components/layout/EnamadBadge";
import { useTranslations } from "next-intl";

interface EnamadFooterProps {
  compact?: boolean;
}

export function EnamadFooter({ compact = false }: EnamadFooterProps) {
    const t = useTranslations('layout');
  return (
    <footer className="glass-surface w-full text-muted-foreground text-xs mt-auto select-none" dir="rtl">
      {compact ? (
        /* نسخه فشرده تک‌خطی مخصوص /chat و /judge: فقط نقطه وضعیت + نماد اینماد.
           سایر پیوندها در منوی همبرگری هدر موجودند. */
        <div className="max-w-6xl mx-auto px-4 py-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2">
            <span className="w-2 h-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
            <span className="truncate font-medium text-foreground/80">{t('enamad-footer.9e708634')}</span>
          </div>

          {/* نماد اینماد: بدون rel و بدون target تا مرورگر ارجاع (referrer) را حذف نکند */}
          <a
            {...ENAMAD_REFERRER_ATTRIBUTE}
            href={enamadTrustUrl("ghazi")}
            className="flex shrink-0 cursor-pointer items-center gap-1 font-medium text-emerald-400 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
          >
            <ShieldCheck className="size-3.5" />
            <span>{t('enamad-footer.7cd985c8')}</span>
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
                <span className="font-bold text-foreground text-sm">{t('enamad-footer.426e3d1f')}</span>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed max-w-md">
                {t('enamad-footer.84ae6f48')}</p>
              <div className="pt-1 flex items-center gap-2 text-muted-foreground text-xs">
                <span>{t('enamad-footer.ecc7d1c9')}</span>
                <a href="tel:09129367796" className="text-amber-400 font-mono font-bold hover:underline">09129367796</a>
              </div>
            </div>

            {/* ستون 2: دسترسی سریع و بکلینک‌ها */}
            <div className="space-y-2">
              <span className="text-foreground font-bold block text-xs">{t('enamad-footer.8b6920ac')}</span>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li><Link href="/chat" className="hover:text-amber-400 transition-colors">{t('enamad-footer.78553dbd')}</Link></li>
                <li><Link href="/guide" className="hover:text-amber-400 transition-colors">{t('enamad-footer.bcfdf90c')}</Link></li>
                <li><Link href="/draft-ruling" className="hover:text-amber-400 transition-colors">{t('enamad-footer.78b28293')}</Link></li>
                <li><Link href="/draft-indictment" className="hover:text-amber-400 transition-colors">{t('enamad-footer.05573f43')}</Link></li>
                <li><Link href="/services" className="hover:text-amber-400 transition-colors">{t('enamad-footer.e8749786')}</Link></li>
                <li><Link href="/technology" className="hover:text-amber-400 transition-colors">{t('enamad-footer.1a744c37')}</Link></li>
                <li><Link href="/laws" className="hover:text-amber-400 transition-colors">{t('enamad-footer.6c34233f')}</Link></li>
                <li><Link href="/coverage" className="hover:text-amber-400 transition-colors">{t('enamad-footer.789eddf1')}</Link></li>
                <li><Link href="/precedents" className="hover:text-amber-400 transition-colors">{t('enamad-footer.2e1efa8c')}</Link></li>
              </ul>
            </div>

            {/* ستون 3: بخش حقوقی و اینماد رسمی */}
            <div className="space-y-3">
              <span className="text-foreground font-bold block text-xs">{t('enamad-footer.4e60530a')}</span>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li><Link href="/about" className="hover:text-amber-400 transition-colors">{t('enamad-footer.78fae5c1')}</Link></li>
                <li><Link href="/contact" className="hover:text-amber-400 transition-colors">{t('enamad-footer.da327363')}</Link></li>
                <li><Link href="/terms" className="hover:text-amber-400 transition-colors">{t('enamad-footer.7d78e37c')}</Link></li>
                <li><Link href="/privacy" className="hover:text-amber-400 transition-colors">{t('enamad-footer.dbb26066')}</Link></li>
              </ul>

              {/* نشان تایید اینماد — کامپوننت مشترک EnamadBadge (اینماد قاضی هوشمند، شناسه 7491439) */}
              <div className="pt-1">
                <EnamadBadge domain="ghazi" />
                <div className="mt-2 text-right text-xs">
                  <span className="block font-bold text-foreground/90">{t('enamad-footer.eb3f1073')}</span>
                  <span className="font-mono text-muted-foreground">{t('enamad-footer.5ca83f95')}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{t('enamad-footer.c1f195db')}</span>
            <div className="flex items-center gap-3">
              <Link href="/guide" className="hover:underline">{t('enamad-footer.bcfdf90c')}</Link>
              <span>•</span>
              <Link href="/terms" className="hover:underline">{t('enamad-footer.1e22820a')}</Link>
              <span>•</span>
              <Link href="/privacy" className="hover:underline">{t('enamad-footer.a278dfeb')}</Link>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}

export default EnamadFooter;
