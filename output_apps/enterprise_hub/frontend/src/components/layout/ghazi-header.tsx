"use client";
import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Calculator,
  FileText,
  LogOut,
  Menu,
  MessageCircle,
  Phone,
  Scale,
  ShieldCheck,
  User,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { UserQuotaBadge } from "@/components/judge/subscription/user-quota-badge";

export function GhaziHeader() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isAuthenticated, openLogin, logout } = useAuth();

  // "/damages" روی دامنه قاضی سرو نمی‌شود (میدل‌ور آن را به roxira.ir
  // هدایت می‌کند)؛ با external:true به‌جای next/link از <a> ساده استفاده
  // می‌شود چون ناوبری کلاینتی Next.js برای ریدایرکت میان‌دامنه‌ای middleware
  // به خطای شبه-CORS در کنسول منجر می‌شود (fetch داده RSC به مبدأ دیگر).
  const navLinks: { href: string; label: string; icon: typeof MessageCircle; external?: boolean }[] = [
    { href: "/chat", label: "گفتگوی حقوقی", icon: MessageCircle },
    { href: "/damages", label: "محاسبه‌گر قضایی و خسارت", icon: Calculator, external: true },
    { href: "/services", label: "محصولات و اشتراک", icon: Zap },
    { href: "/technology", label: "تکنولوژی و معماری", icon: Building2 },
    { href: "/about", label: "درباره سامانه", icon: Scale },
    { href: "/contact", label: "تماس با ما", icon: Phone },
    { href: "/terms", label: "قوانین و مقررات", icon: FileText },
    { href: "/privacy", label: "حریم خصوصی", icon: ShieldCheck },
  ];

  const handleOpenAuth = () => {
    openLogin({
      serviceDomain: "GHAZI",
      title: "ورود به سامانه قاضی هوشمند",
      description: "شماره همراه خود را وارد کنید؛ کد تأیید پیامکی ارسال می‌شود.",
    });
  };

  return (
    <header className="glass-surface sticky top-0 z-40 w-full transition-all motion-reduce:transition-none" dir="rtl">
      {/* ردیف اصلی هدر */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-4">
        {/* لوگو و عنوان سامانه */}
        <div className="flex items-center gap-3">
          <Link
            href="/chat"
            className="flex items-center gap-2.5 sm:gap-3 group rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/40 flex items-center justify-center text-amber-400 group-hover:scale-105 group-hover:border-amber-400 transition-all shadow-[0_0_15px_rgba(245,158,11,0.15)]">
              <Scale className="size-5" strokeWidth={2} />
            </div>
            <div>
              <span className="font-bold text-sm sm:text-base text-foreground tracking-tight">قاضی هوشمند</span>
              <p className="text-[10px] text-muted-foreground hidden sm:block">دستیار حقوقی</p>
            </div>
          </Link>
        </div>

        {/* ناوبری دسکتاپ */}
        <nav className="hidden lg:flex items-center gap-1.5 xl:gap-2">
          {navLinks.map(({ href, label, icon: Icon, external }) => {
            const isActive = pathname === href;
            const className = `px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
              isActive
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
            }`;
            const content = (
              <>
                <Icon className="size-3.5" />
                <span>{label}</span>
              </>
            );
            return external ? (
              <a key={href} href={href} className={className}>
                {content}
              </a>
            ) : (
              <Link key={href} href={href} className={className}>
                {content}
              </Link>
            );
          })}
        </nav>

        {/* بخش وضعیت کاربر */}
        <div className="flex items-center gap-2 sm:gap-3">
          {isAuthenticated ? (
            <>
              <UserQuotaBadge />
              <button
                onClick={logout}
                className="text-[11px] text-muted-foreground hover:text-destructive px-2 py-1 bg-muted/80 hover:bg-muted rounded-lg border border-border transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                title="خروج از حساب کاربری"
              >
                <LogOut className="size-3.5" />
                <span>خروج</span>
              </button>
            </>
          ) : (
            <button
              onClick={handleOpenAuth}
              className="px-3 sm:px-3.5 py-1.5 bg-gradient-to-l from-amber-500/20 to-amber-600/20 hover:from-amber-500/30 hover:to-amber-600/30 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shadow-[0_0_12px_rgba(245,158,11,0.15)] active:scale-95 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <User className="size-3.5" />
              <span>ورود / ثبت‌نام</span>
            </button>
          )}

          {/* دکمه منوی موبایل */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-xl bg-muted border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            title="منوی ناوبری"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {/* نوار بکلینک‌های اسکرولی افقی زیر هدر (روی موبایل و تبلت همیشه فعال) */}
      <div className="lg:hidden border-t border-border/60 bg-transparent px-2 sm:px-4 py-1.5 overflow-x-auto no-scrollbar scroll-fade-x flex items-center gap-1.5 text-xs">
        {navLinks.map(({ href, label, icon: Icon, external }) => {
          const isActive = pathname === href;
          const className = `px-2.5 py-1 rounded-lg whitespace-nowrap text-[11px] flex items-center gap-1 transition-all focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
            isActive
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold"
              : "bg-muted/80 text-muted-foreground hover:text-foreground border border-border/70"
          }`;
          const content = (
            <>
              <Icon className="size-3.5" />
              <span>{label}</span>
            </>
          );
          return external ? (
            <a key={href} href={href} className={className}>
              {content}
            </a>
          ) : (
            <Link key={href} href={href} className={className}>
              {content}
            </Link>
          );
        })}
      </div>

      {/* منوی بازشونده کشویی موبایل */}
      {mobileMenuOpen && (
        <div className="glass-overlay lg:hidden px-4 py-4 space-y-3 animate-in slide-in-from-top-2 duration-150 motion-reduce:animate-none">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {navLinks.map(({ href, label, icon: Icon, external }) => {
              const className = `p-2.5 rounded-xl border flex items-center gap-2 transition-all focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                pathname === href
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold"
                  : "bg-background/60 border-border text-muted-foreground hover:border-ring/50"
              }`;
              const content = (
                <>
                  <Icon className="size-3.5" />
                  <span>{label}</span>
                </>
              );
              return external ? (
                <a
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={className}
                >
                  {content}
                </a>
              ) : (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={className}
                >
                  {content}
                </Link>
              );
            })}
          </div>

          <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>مرکز تماس: <a href="tel:09129367796" className="text-amber-400 font-mono">09129367796</a></span>
            {!isAuthenticated && (
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleOpenAuth();
                }}
                className="text-amber-400 font-semibold underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded"
              >
                ورود با پیامک (OTP)
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export default GhaziHeader;
