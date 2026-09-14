"use client";
import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";

interface GhaziHeaderProps {
  userPhone?: string;
  isVip?: boolean;
}

export function GhaziHeader({ userPhone = "09129367796", isVip = true }: GhaziHeaderProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, isAuthenticated, openLogin, logout } = useAuth();

  // کاربر جاری: اگر در سامانه لاگین کرده باشد اطلاعات سشن، در غیر این صورت وضعیت پیش‌فرض
  const currentPhone = user?.phone || userPhone;
  const isUserVip = currentPhone === "09129367796" || (user as any)?.subscriptionTier === "VIP" || isVip;

  const navLinks = [
    { href: "/chat", label: "گفتگوی حقوقی", icon: "💬" },
    { href: "/services", label: "محصولات و اشتراک", icon: "⚡" },
    { href: "/technology", label: "تکنولوژی و معماری", icon: "🔬" },
    { href: "/about", label: "درباره سامانه", icon: "🏛️" },
    { href: "/contact", label: "تماس با ما", icon: "📞" },
    { href: "/terms", label: "قوانین و مقررات", icon: "📜" },
    { href: "/privacy", label: "حریم خصوصی", icon: "🛡️" },
  ];

  const handleOpenAuth = () => {
    openLogin({
      serviceDomain: "GHAZI",
      title: "ورود به سامانه قاضی هوشمند",
      description: "شماره همراه خود را وارد کنید؛ کد تأیید ۵ رقمی از طریق پیامک کاوه‌نگار ارسال می‌شود.",
    });
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-slate-950/95 border-b border-slate-800/80 backdrop-blur-2xl transition-all shadow-lg" dir="rtl">
      {/* ردیف اصلی هدر */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-4">
        {/* لوگو و نام سامانه */}
        <div className="flex items-center gap-3">
          <Link href="/chat" className="flex items-center gap-2.5 sm:gap-3 group">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/40 flex items-center justify-center text-amber-400 font-bold text-lg group-hover:scale-105 group-hover:border-amber-400 transition-all shadow-[0_0_15px_rgba(245,158,11,0.15)]">
              ⚖️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm sm:text-base text-amber-400 tracking-tight">قاضی هوشمند</span>
                <span className="inline-block text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono">
                  AI RAG v2.6
                </span>
              </div>
              <p className="text-[10px] text-slate-400 hidden sm:block">دستیار تخصصی حقوقی و قضایی مبتنی بر هوش مصنوعی</p>
            </div>
          </Link>
        </div>

        {/* ناوبری دسکتاپ */}
        <nav className="hidden lg:flex items-center gap-1.5 xl:gap-2">
          {navLinks.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 ${
                  isActive
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold shadow-sm"
                    : "text-slate-300 hover:text-white hover:bg-slate-900 border border-transparent"
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* دکمه‌های وضعیت کاربر و ورود پیامکی با کاوه‌نگار */}
        <div className="flex items-center gap-2 sm:gap-3">
          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              <span className={`px-2.5 sm:px-3 py-1 rounded-full text-[11px] sm:text-xs flex items-center gap-1.5 font-mono shadow-sm border ${
                isUserVip
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : "bg-slate-900 border-slate-800 text-slate-300"
              }`}>
                <span className={`w-2 h-2 rounded-full ${isUserVip ? "bg-emerald-400 animate-pulse" : "bg-slate-400"}`} />
                <span>{user?.phone}</span>
                {isUserVip && <span className="font-bold text-[9px] bg-emerald-500/30 px-1 py-0.5 rounded text-emerald-200">VIP</span>}
              </span>
              <button
                onClick={logout}
                className="text-[11px] text-slate-400 hover:text-rose-400 px-2 py-1 bg-slate-900/80 hover:bg-slate-800 rounded-lg border border-slate-800 transition-colors"
                title="خروج از حساب"
              >
                خروج
              </button>
            </div>
          ) : (
            <button
              onClick={handleOpenAuth}
              className="px-3 sm:px-3.5 py-1.5 bg-gradient-to-l from-amber-500/20 to-amber-600/20 hover:from-amber-500/30 hover:to-amber-600/30 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shadow-[0_0_12px_rgba(245,158,11,0.15)] active:scale-95"
            >
              <span>👤</span>
              <span>ورود / ثبت‌نام</span>
            </button>
          )}

          {/* نشان ارتقا یا وضعیت VIP پیش‌فرض */}
          {!isAuthenticated && isVip && (
            <span className="hidden sm:inline-flex px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] rounded-full items-center gap-1.5 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{userPhone} (VIP)</span>
            </span>
          )}

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

      {/* نوار بکلینک‌های اسکرولی افقی زیر هدر (روی موبایل و تبلت همیشه فعال) */}
      <div className="lg:hidden border-t border-slate-800/60 bg-slate-950/90 px-2 sm:px-4 py-1.5 overflow-x-auto no-scrollbar flex items-center gap-1.5 text-xs">
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
        <div className="lg:hidden border-t border-slate-800 bg-slate-900/98 px-4 py-4 space-y-3 backdrop-blur-2xl shadow-2xl animate-in slide-in-from-top-2 duration-150">
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
            <span>پشتیبانی پیامکی/تلفنی: <a href="tel:09129367796" className="text-amber-400 font-mono">09129367796</a></span>
            {!isAuthenticated && (
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleOpenAuth();
                }}
                className="text-amber-400 font-semibold underline"
              >
                ورود با OTP
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export default GhaziHeader;
