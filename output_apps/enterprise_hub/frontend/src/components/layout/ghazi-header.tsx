"use client";
import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface GhaziHeaderProps {
  userPhone?: string;
  isVip?: boolean;
}

export function GhaziHeader({ userPhone = "09129367796", isVip = true }: GhaziHeaderProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: "/chat", label: "گفتگوی حقوقی", icon: "💬" },
    { href: "/services", label: "محصولات و اشتراک", icon: "⚡" },
    { href: "/technology", label: "تکنولوژی و معماری", icon: "🔬" },
    { href: "/about", label: "درباره سامانه", icon: "🏛️" },
    { href: "/contact", label: "تماس با ما", icon: "📞" },
    { href: "/terms", label: "قوانین و مقررات", icon: "📜" },
    { href: "/privacy", label: "حریم خصوصی", icon: "🛡️" },
  ];

  return (
    <header className="sticky top-0 z-40 w-full bg-slate-950/95 border-b border-slate-800/80 backdrop-blur-xl transition-all shadow-md" dir="rtl">
      {/* ردیف اصلی هدر */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-4">
        {/* نشان و عنوان سامانه */}
        <div className="flex items-center gap-3">
          <Link href="/chat" className="flex items-center gap-2 sm:gap-3 group">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-lg group-hover:scale-105 group-hover:border-amber-400 transition-all shadow-inner">
              ⚖️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm sm:text-base text-amber-400 tracking-tight">قاضی هوشمند</span>
                <span className="hidden xs:inline-block text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono">v2.4</span>
              </div>
              <p className="text-[10px] text-slate-400 hidden sm:block">دستیار تخصصی حقوقی و قضایی مبتنی بر هوش مصنوعی</p>
            </div>
          </Link>
        </div>

        {/* ناوبری دسکتاپ (صفحه‌نمایش‌های بزرگتر از lg) */}
        <nav className="hidden lg:flex items-center gap-1 xl:gap-2">
          {navLinks.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 ${
                  isActive
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold"
                    : "text-slate-300 hover:text-white hover:bg-slate-900 border border-transparent"
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* دکمه‌های کاربری و همبرگری موبایل */}
        <div className="flex items-center gap-2 sm:gap-3">
          {isVip ? (
            <span className="px-2.5 sm:px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] sm:text-xs rounded-full flex items-center gap-1.5 font-mono shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{userPhone}</span>
              <span className="font-bold text-[10px] bg-emerald-500/20 px-1 rounded">VIP</span>
            </span>
          ) : (
            <Link
              href="/services"
              className="px-2.5 sm:px-3 py-1 bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 text-xs rounded-full flex items-center gap-1 transition-colors font-medium"
            >
              ⭐ ارتقا به VIP
            </Link>
          )}

          <Link
            href="/admin"
            className="text-xs text-slate-300 hover:text-white px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-800 transition-colors hidden sm:inline-flex items-center gap-1"
          >
            <span>🔐</span>
            <span>ورود ادمین</span>
          </Link>

          {/* دکمه منوی موبایل */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="منوی ناوبری"
          >
            {mobileMenuOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* نوار بکلینک‌های اسکرولی افقی - همیشه روی تبلت و موبایل قابل مشاهده است */}
      <div className="lg:hidden border-t border-slate-800/60 bg-slate-950/80 px-2 sm:px-4 py-1.5 overflow-x-auto no-scrollbar flex items-center gap-1.5 text-xs">
        {navLinks.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`px-2.5 py-1 rounded-lg whitespace-nowrap text-[11px] flex items-center gap-1 transition-all ${
                isActive
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold"
                  : "bg-slate-900/80 text-slate-300 hover:text-white border border-slate-800/70"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>

      {/* منوی بازشونده کشویی موبایل */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-slate-800 bg-slate-900/98 px-4 py-4 space-y-2 backdrop-blur-2xl shadow-2xl animate-in slide-in-from-top-2 duration-150">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {navLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`p-2.5 rounded-xl border flex items-center gap-2 transition-all ${
                  pathname === item.href
                    ? "bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold"
                    : "bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>پشتیبانی مستقیم: <a href="tel:09129367796" className="text-amber-400 font-mono">09129367796</a></span>
            <Link href="/admin" className="text-slate-300 hover:text-white underline">ورود ادمین</Link>
          </div>
        </div>
      )}
    </header>
  );
}

export default GhaziHeader;
