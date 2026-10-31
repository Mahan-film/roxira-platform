"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  BookOpenCheck,
  ClipboardList,
  FileUp,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Puzzle,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound,
  Warehouse,
  X,
  Contact,
  Landmark,
  type LucideIcon,
} from "lucide-react";

import { AccessProvider, useAccess } from "@/components/app/access-provider";
import { CommandPalette } from "@/components/app/command-palette";
import { OrgOnboarding } from "@/components/app/org-onboarding";
import { OrgSwitcher } from "@/components/app/org-switcher";
import { DropOverlay } from "@/components/app/drop-overlay";
import { ImportHandoffProvider } from "@/components/app/import-handoff";
import { useAuth } from "@/components/auth/auth-provider";
import { ClientErrorReporter } from "@/components/observability/client-error-reporter";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { useAssistantEnabled } from "@/lib/use-assistant-enabled";
import { cn } from "@/lib/utils";
import type { AccessModuleKey } from "@/types/access";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Highlight the item for every nested path, not only the exact one. */
  nested: boolean;
  /** Shown only when the organisation has this module and the role can read it (UX; the server decides). */
  module?: AccessModuleKey;
  /** Shown only to Roxira platform operators. */
  platformAdmin?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/app", label: "داشبورد", icon: LayoutDashboard, nested: false },
  { href: "/app/crm", label: "مشتریان (CRM)", icon: Contact, nested: true, module: "crm" },
  { href: "/app/hr", label: "کارکنان (HR)", icon: UsersRound, nested: true, module: "hr" },
  { href: "/app/inventory", label: "کالا و انبار", icon: Warehouse, nested: true, module: "inventory" },
  { href: "/app/accounting", label: "حساب‌ها", icon: BookOpenCheck, nested: true, module: "accounting" },
  { href: "/app/cheques", label: "چک‌ها", icon: Banknote, nested: true, module: "cheques" },
  { href: "/app/invoicing", label: "صورتحساب‌ها", icon: ReceiptText, nested: true, module: "invoicing" },
  { href: "/app/tax", label: "مالیات و مودیان", icon: Landmark, nested: true, module: "tax" },
  { href: "/app/import", label: "ورود داده (import)", icon: FileUp, nested: true, module: "data_import" },
  { href: "/app/assistant", label: "دستیار هوشمند", icon: MessageSquareText, nested: false, module: "assistant" },
  { href: "/app/settings/members", label: "اعضا و نقش‌ها", icon: Settings, nested: true, module: "members" },
  { href: "/app/settings/modules", label: "ماژول‌ها", icon: Puzzle, nested: true, module: "members" },
  { href: "/app/settings/audit", label: "گزارش رخدادها", icon: ClipboardList, nested: true, module: "audit" },
  { href: "/app/settings/security", label: "امنیت حساب", icon: ShieldCheck, nested: true },
  { href: "/app/admin/entitlements", label: "ماژول‌های مشتریان", icon: KeyRound, nested: true, platformAdmin: true },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true;
  return item.nested && pathname.startsWith(item.href + "/");
}

function SidebarContent({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const { user, logout } = useAuth();
  const assistantEnabled = useAssistantEnabled() === true;
  const { can } = useAccess();
  const navItems = NAV_ITEMS.filter((item) => {
    if (item.href === "/app/assistant" && !assistantEnabled) return false;
    if (item.platformAdmin) return user?.role === "ADMIN";
    if (item.href === "/app") return true;
    if (!item.module) return true;
    return can(item.module, "read");
  });
  return (
    <div className="flex h-full flex-col gap-4">
      <Link
        href="/app"
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-2 pt-1"
      >
        <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-black text-white shadow-lg shadow-indigo-600/30">
          R
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-bold text-foreground">نرم‌افزار روکسیرا</span>
          <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
            Business Suite
          </span>
        </span>
      </Link>

      <OrgSwitcher />
      <nav aria-label="منوی نرم‌افزار" className="flex flex-1 flex-col gap-1">
        {navItems.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-indigo-500/15 font-bold text-indigo-300 ring-1 ring-indigo-500/30"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        {user && (
          <span className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
            <UserRound className="size-3.5" aria-hidden="true" />
            <span dir="ltr" className="font-mono">
              {user.phone ?? user.email ?? user.username}
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200"
        >
          <LogOut className="size-3.5" aria-hidden="true" />
          خروج از حساب
        </button>
        <Link
          href="/"
          className="px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          بازگشت به سایت روکسیرا
        </Link>
      </div>
    </div>
  );
}

/**
 * What the main area shows before any page: a person without an organisation
 * creates or joins one; a member of an organisation that requires two-factor
 * sign-in sets it up first. Security settings stay reachable in both cases.
 */
function ShellContent({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { loading, org, error } = useAccess();
  const onSecurity = pathname.startsWith("/app/settings/security");
  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        در حال بارگذاری دسترسی‌ها…
      </p>
    );
  }
  if (error && !org) {
    return <p role="alert" className="text-sm text-rose-300">{error}</p>;
  }
  if (!org && !onSecurity) {
    return <OrgOnboarding />;
  }
  if (org && org.require2fa && !org.mfa && !onSecurity) {
    return (
      <div role="alert" data-testid="mfa-required" className="flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm">
        <p className="font-bold">این سازمان ورود دومرحله‌ای را الزامی کرده است.</p>
        <p className="text-muted-foreground">برای ادامه، برنامهٔ احراز هویت (TOTP) را فعال کنید و دوباره وارد شوید.</p>
        <Link href="/app/settings/security" className="w-fit rounded-xl bg-indigo-500 px-4 py-2 text-xs font-bold text-white">
          رفتن به تنظیمات امنیت
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Logged-in application shell for roxira.ir/app: right-side sidebar in RTL,
 * collapsible drawer on mobile. Access is gated by the same OTP login
 * (AuthProvider + EnterpriseRouteGuard) the rest of the portal uses.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The drawer is "open at" a path, so it closes by itself on route change.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const drawerOpen = openAt === pathname;
  const setDrawerOpen = (open: boolean) => setOpenAt(open ? pathname : null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <EnterpriseRouteGuard>
      <AccessProvider>
      <ImportHandoffProvider>
        <div className="dark flex min-h-screen flex-1 bg-background text-foreground">
          <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-l border-border bg-card/60 p-4 lg:block">
            <SidebarContent pathname={pathname} />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="باز کردن منو"
                aria-expanded={drawerOpen}
                className="inline-flex size-10 items-center justify-center rounded-xl border border-border lg:hidden"
              >
                <Menu className="size-5" aria-hidden="true" />
              </button>
              <span className="text-sm font-bold lg:hidden">نرم‌افزار روکسیرا</span>
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="جست‌وجو و فرمان‌ها"
                className="ms-auto inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Search className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">جست‌وجو یا فرمان…</span>
                <kbd
                  className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] sm:inline"
                  dir="ltr"
                >
                  Ctrl K
                </kbd>
              </button>
            </header>

            <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
              <ShellContent pathname={pathname}>{children}</ShellContent>
            </main>
          </div>

          {drawerOpen && (
            <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
              <button
                type="button"
                aria-label="بستن منو"
                className="absolute inset-0 bg-black/60"
                onClick={() => setDrawerOpen(false)}
              />
              <div className="absolute inset-y-0 right-0 w-72 max-w-[85vw] border-l border-border bg-background p-4 shadow-2xl">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="بستن منو"
                  className="absolute top-3 left-3 inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
                <SidebarContent
                  pathname={pathname}
                  onNavigate={() => setDrawerOpen(false)}
                />
              </div>
            </div>
          )}

          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
          <DropOverlay />
          <ClientErrorReporter />
        </div>
      </ImportHandoffProvider>
      </AccessProvider>
    </EnterpriseRouteGuard>
  );
}
