"use client";
import React from "react";
import Link from "next/link";

interface GhaziHeaderProps {
  userPhone?: string;
  isVip?: boolean;
}

export function GhaziHeader({ userPhone = "09129367796", isVip = true }: GhaziHeaderProps) {
  return (
    <header className="px-4 sm:px-6 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80 sticky top-0 z-30 backdrop-blur-md" dir="rtl">
      <div className="flex items-center gap-6">
        <Link href="/chat" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-lg group-hover:scale-105 transition-transform shadow-inner">
            ⚖️
          </div>
          <div>
            <h1 className="font-bold text-base text-amber-400 tracking-tight">قاضی هوشمند</h1>
            <p className="text-[10px] text-slate-400">دستیار تخصصی حقوقی و قضایی مبتنی بر هوش مصنوعی</p>
          </div>
        </Link>

        {/* پیوندهای ناوبری رسمی */}
        <nav className="hidden md:flex items-center gap-5 text-xs text-slate-300">
          <Link href="/chat" className="hover:text-amber-400 transition-colors font-medium">
            گفتگوی حقوقی
          </Link>
          <Link href="/services" className="hover:text-amber-400 transition-colors font-medium">
            محصولات و اشتراک
          </Link>
          <Link href="/about" className="hover:text-amber-400 transition-colors font-medium">
            درباره سامانه
          </Link>
          <Link href="/terms" className="hover:text-amber-400 transition-colors font-medium">
            قوانین و مقررات
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {isVip ? (
          <span className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs rounded-full flex items-center gap-1.5 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {userPhone} (VIP)
          </span>
        ) : (
          <Link
            href="/services"
            className="px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs rounded-full flex items-center gap-1.5 transition-colors font-medium"
          >
            ⭐ ارتقا به VIP
          </Link>
        )}
        <Link
          href="/admin"
          className="text-xs text-slate-400 hover:text-white px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-800 transition-colors"
        >
          ورود ادمین
        </Link>
      </div>
    </header>
  );
}

export default GhaziHeader;
