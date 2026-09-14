"use client";
import React, { useState } from "react";
import Link from "next/link";

interface EnamadFooterProps {
  compact?: boolean;
}

export function EnamadFooter({ compact = false }: EnamadFooterProps) {
  const [imgError, setImgError] = useState(false);

  return (
    <footer className="w-full border-t border-slate-800/80 bg-slate-950 text-slate-400 text-xs mt-auto select-none" dir="rtl">
      {compact ? (
        /* نسخه فشرده مخصوص پایین صفحه چت */
        <div className="max-w-6xl mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-300 font-medium">قاضی هوشمند | دستیار تخصصی دادرسی و ادله</span>
          </div>

          <nav className="flex flex-wrap items-center gap-3">
            <Link href="/about" className="hover:text-amber-400 transition-colors">درباره ما</Link>
            <span>•</span>
            <Link href="/contact" className="hover:text-amber-400 transition-colors">تماس با ما</Link>
            <span>•</span>
            <Link href="/technology" className="hover:text-amber-400 transition-colors">تکنولوژی RAG</Link>
            <span>•</span>
            <Link href="/services" className="hover:text-amber-400 transition-colors">محصولات و اشتراک</Link>
            <span>•</span>
            <Link href="/terms" className="hover:text-amber-400 transition-colors">قوانین</Link>
            <span>•</span>
            <Link href="/privacy" className="hover:text-amber-400 transition-colors">حریم خصوصی</Link>
            <span>•</span>
            <a
              href="https://trustseal.enamad.ir/?id=7491439&Code=yFeNLueqB3RV5ZK9nT7avRH3IR8jSeYa"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1 font-medium"
            >
              <span>🛡️</span>
              <span>اینماد ۷۴۹۱۴۳۹</span>
            </a>
          </nav>
        </div>
      ) : (
        /* نسخه کامل با تمام بکلینک‌های سئو و نماد اعتماد */
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-xs border-b border-slate-800/80 pb-6">
            {/* ستون ۱: معرفی سامانه */}
            <div className="space-y-2 md:col-span-2">
              <div className="flex items-center gap-2">
                <span className="text-amber-400 text-lg">⚖️</span>
                <span className="font-bold text-white text-sm">سامانه هوشمند قاضی هوشمند</span>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed max-w-md">
                اولین پلتفرم بومی پردازش زبان حقوقی، استخراج ادله اثبات دعوی و انشای لوایح مستند به ۵٬۱۸۴ گره تنقیح‌شده قوانین و آرای دیوان عالی کشور بر پایه معماری Dual-Level GraphRAG.
              </p>
              <div className="pt-1 flex items-center gap-2 text-slate-400 text-[11px]">
                <span>پشتیبانی شبانه‌روزی:</span>
                <a href="tel:09129367796" className="text-amber-400 font-mono font-bold hover:underline">09129367796</a>
              </div>
            </div>

            {/* ستون ۲: دسترسی سریع و بکلینک‌ها */}
            <div className="space-y-2">
              <span className="text-white font-bold block text-xs">خدمات و ماژول‌ها</span>
              <ul className="space-y-1.5 text-[11px] text-slate-300">
                <li><Link href="/chat" className="hover:text-amber-400 transition-colors">💬 گفتگوی دادرسی و تحلیل ادله</Link></li>
                <li><Link href="/services" className="hover:text-amber-400 transition-colors">⚡ طرح‌های اشتراک و مقایسه VIP</Link></li>
                <li><Link href="/technology" className="hover:text-amber-400 transition-colors">🔬 معماری فنی و گراف دانش RAG</Link></li>
                <li><Link href="/laws" className="hover:text-amber-400 transition-colors">📚 پایگاه مواد و تنقیح قوانین</Link></li>
                <li><Link href="/precedents" className="hover:text-amber-400 transition-colors">📜 آرای وحدت رویه دیوان عالی</Link></li>
              </ul>
            </div>

            {/* ستون ۳: بخش حقوقی و اینماد رسمی */}
            <div className="space-y-3">
              <span className="text-white font-bold block text-xs">اعتبار قانونی و مجوزها</span>
              <ul className="space-y-1.5 text-[11px] text-slate-300">
                <li><Link href="/about" className="hover:text-amber-400 transition-colors">🏛️ درباره سامانه و مدیریت</Link></li>
                <li><Link href="/contact" className="hover:text-amber-400 transition-colors">📞 تماس با پشتیبانی رسمی</Link></li>
                <li><Link href="/terms" className="hover:text-amber-400 transition-colors">⚖️ قوانین، مقررات و سلب مسئولیت</Link></li>
                <li><Link href="/privacy" className="hover:text-amber-400 transition-colors">🛡️ حفظ محرمانگی اسناد و پرونده</Link></li>
              </ul>

              {/* نشان تایید اینماد با فالبک هوشمند بدون خرابی تصویر */}
              <div className="pt-1">
                <a
                  href="https://trustseal.enamad.ir/?id=7491439&Code=yFeNLueqB3RV5ZK9nT7avRH3IR8jSeYa"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-emerald-500/50 transition-colors group"
                >
                  {!imgError ? (
                    <img
                      src="https://trustseal.enamad.ir/logo.aspx?id=7491439&Code=yFeNLueqB3RV5ZK9nT7avRH3IR8jSeYa"
                      alt="نماد اعتماد الکترونیکی قاضی هوشمند"
                      className="w-8 h-8 object-contain bg-white rounded-lg p-0.5"
                      onError={() => setImgError(true)}
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm">
                      ✓
                    </div>
                  )}
                  <div className="text-[10px] text-right">
                    <span className="block font-bold text-slate-200 group-hover:text-emerald-400 transition-colors">نماد اعتماد الکترونیکی</span>
                    <span className="text-slate-500 font-mono">شناسه: ۷۴۹۱۴۳۹</span>
                  </div>
                </a>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-slate-500">
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
