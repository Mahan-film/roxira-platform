"use client";

import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { PortalAuthActions } from "@/components/auth/portal-auth-actions";
import { PortalMobileNav } from "@/components/layout/portal-mobile-nav";

const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/accounting", label: "حسابداری" },
  { href: "/invoicing", label: "صورتحساب و مالیات" },
  { href: "/inventory", label: "انبار" },
  { href: "/hr", label: "منابع انسانی" },
  { href: "/crm", label: "CRM" },
  { href: "/team", label: "سازمان و اعضا" },
  { href: "/contact", label: "تماس" },
];

export function SiteHeader() {
  const { isAuthenticated, user, logout, isLoading } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#020617]/90 text-slate-100 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
          <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-black text-white shadow-lg shadow-indigo-600/30">
            R
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-bold text-white">روکسیرا</span>
            <span className="font-mono text-[10px] text-slate-500" dir="ltr">
              Roxira
            </span>
          </span>
        </Link>

        <nav className="hidden min-w-0 items-center gap-1 text-sm xl:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="whitespace-nowrap rounded-lg px-2.5 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <PortalMobileNav links={NAV_LINKS} />

        {!isLoading && isAuthenticated && user ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-300 sm:inline-flex">
              <UserRound className="size-3.5" />
              <span dir="ltr" className="font-mono">
                {user.phone}
              </span>
            </span>
            <button
              type="button"
              onClick={logout}
              title="خروج از حساب"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300 transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200"
            >
              <LogOut className="size-3.5" />
              خروج
            </button>
          </div>
        ) : (
          <PortalAuthActions />
        )}
      </div>
    </header>
  );
}
