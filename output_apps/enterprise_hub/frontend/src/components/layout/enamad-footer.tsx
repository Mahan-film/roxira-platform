"use client";
import React from "react";

export function EnamadFooter() {
  // کد خام و رسمی استخراج‌شده از پنل اینماد قاضی هوشمند بدون تگ‌های مسدودکننده rel
  const rawEnamadCode = `<a referrerpolicy='origin' target='_blank' href='https://trustseal.enamad.ir/?id=7491439&Code=yFeNLueqB3RV5ZK9nT7avRH3IR8jSeYa'><img referrerpolicy='origin' src='https://trustseal.enamad.ir/logo.aspx?id=7491439&Code=yFeNLueqB3RV5ZK9nT7avRH3IR8jSeYa' alt='' style='cursor:pointer; width:44px; height:44px; object-fit:contain;' code='yFeNLueqB3RV5ZK9nT7avRH3IR8jSeYa'></a>`;

  return (
    <footer className="w-full py-3.5 border-t border-slate-800/80 bg-slate-950/90 mt-auto flex flex-col sm:flex-row items-center justify-between px-6 gap-4 text-xs text-slate-400 z-10 relative select-none">
      <div className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="font-medium text-slate-300">سامانه هوشمند قاضی هوشمند | پلتفرم سازمانی روکسیرا</span>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4 text-slate-400">
          <a href="/privacy" className="hover:text-amber-400 transition-colors">حریم خصوصی</a>
          <span>•</span>
          <a href="/terms" className="hover:text-amber-400 transition-colors">شرایط استفاده</a>
          <span>•</span>
          <a href="tel:09129367796" className="hover:text-amber-400 transition-colors font-mono">09129367796</a>
        </div>

        {/* جعبه اختصاصی لوگوی رسمی اینماد */}
        <div className="bg-white p-1 rounded-xl border border-slate-700 shadow-sm flex items-center justify-center hover:opacity-90 transition-opacity">
          <div dangerouslySetInnerHTML={{ __html: rawEnamadCode }} />
        </div>
      </div>
    </footer>
  );
}

export default EnamadFooter;
