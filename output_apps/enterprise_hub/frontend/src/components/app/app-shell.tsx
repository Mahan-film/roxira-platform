"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LogOut, Menu, Plus, Search, UserRound, X } from "lucide-react";

import { AccessProvider, useAccess } from "@/components/app/access-provider";
import { CommandPalette } from "@/components/app/command-palette";
import { OrgOnboarding } from "@/components/app/org-onboarding";
import { OrgSwitcher } from "@/components/app/org-switcher";
import { DropOverlay } from "@/components/app/drop-overlay";
import { ImportHandoffProvider } from "@/components/app/import-handoff";
import { useAuth } from "@/components/auth/auth-provider";
import { ClientErrorReporter } from "@/components/observability/client-error-reporter";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { navIcon } from "@/components/app/nav-icons";
import { useAssistantEnabled } from "@/lib/use-assistant-enabled";
import { OPERATOR_ITEMS, activeHref, visibleGroups } from "@/lib/nav-menu";
import { cn } from "@/lib/utils";

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
  const groups = visibleGroups(can, { assistantEnabled });
  const hrefs = [
    ...groups.flatMap((group) => group.items.map((item) => item.href)),
    ...(user?.role === "ADMIN" ? OPERATOR_ITEMS.map((item) => item.href) : []),
  ];
  const active = activeHref(pathname, hrefs);
  // All groups start expanded; collapsing is only in-memory, never persisted.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const idBase = useId();
  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 [&_select]:focus-visible:outline-none [&_select]:focus-visible:ring-2 [&_select]:focus-visible:ring-ring">
      <Link
        href="/app"
        onClick={onNavigate}
        className="flex items-center gap-2.5 rounded-xl px-2 pt-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      <nav
        aria-label="منوی نرم‌افزار"
        data-testid="app-sidebar-nav"
        className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-1"
      >
        {groups.map((group) => {
          const GroupIcon = navIcon(group.icon);
          const isOpen = !collapsed.has(group.id);
          const panelId = `${idBase}-${group.id}-panel`;
          return (
            <div key={group.id} className="flex flex-col">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggleGroup(group.id)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <GroupIcon className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1 text-start">{group.label}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 transition-transform",
                    isOpen ? "" : "-rotate-90",
                  )}
                />
              </button>
              <ul id={panelId} hidden={!isOpen} className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = navIcon(item.icon);
                  const itemActive = active === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={itemActive ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl px-3 py-2.5 ps-6 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          itemActive
                            ? "bg-indigo-500/15 font-bold text-indigo-300 ring-1 ring-indigo-500/30"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {user?.role === "ADMIN" && OPERATOR_ITEMS.length > 0 && (
          <div className="flex flex-col border-t border-border pt-2 mt-2">
            <span className="px-3 pt-1 pb-1 text-[11px] font-bold tracking-wide text-muted-foreground/70">
              مدیریت پلتفرم
            </span>
            <ul className="flex flex-col gap-0.5">
              {OPERATOR_ITEMS.map((item) => {
                const Icon = navIcon(item.icon);
                const itemActive = active === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={itemActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        itemActive
                          ? "bg-indigo-500/15 font-bold text-indigo-300 ring-1 ring-indigo-500/30"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </nav>

      <div className="flex shrink-0 flex-col gap-2 border-t border-border pt-3">
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
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="size-3.5" aria-hidden="true" />
          خروج از حساب
        </button>
        <Link
          href="/"
          className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  const [paletteMode, setPaletteMode] = useState<"all" | "create">("all");
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // The search button and Ctrl+K open the palette in "all" mode; the create
  // button opens it in "create" mode.
  const openPalette = (mode: "all" | "create") => {
    setPaletteMode(mode);
    setPaletteOpen(true);
  };
  const handlePaletteOpenChange = (open: boolean) => {
    if (open) setPaletteMode("all");
    setPaletteOpen(open);
  };

  // The app is dark. Put the theme on <html> too, so body (bg-background) is dark and no white page
  // shows past the shell (#277). Removed again when leaving /app for the light public site.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!hadDark) root.classList.remove("dark");
    };
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpenAt(null);
        const menuButton =
          menuButtonRef.current ??
          document.querySelector<HTMLButtonElement>('button[aria-label="باز کردن منو"]');
        menuButton?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  return (
    <EnterpriseRouteGuard>
      <AccessProvider>
      <ImportHandoffProvider>
        <div className="dark flex min-h-screen flex-1 bg-background text-foreground">
          <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto overscroll-contain border-e border-border bg-card/60 p-4 lg:block">
            <SidebarContent pathname={pathname} />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="باز کردن منو"
                aria-expanded={drawerOpen}
                className="inline-flex size-10 items-center justify-center rounded-xl border border-border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
              >
                <Menu className="size-5" aria-hidden="true" />
              </button>
              <span className="text-sm font-bold lg:hidden">نرم‌افزار روکسیرا</span>
              <button
                type="button"
                onClick={() => openPalette("all")}
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
              <button
                type="button"
                onClick={() => openPalette("create")}
                aria-label="ثبت جدید"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-xs font-bold text-indigo-300 transition-colors hover:bg-indigo-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-auto sm:gap-2 sm:px-3"
              >
                <Plus className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">ثبت جدید</span>
              </button>
            </header>

            <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
              <ShellContent pathname={pathname}>{children}</ShellContent>
            </main>
          </div>

          {drawerOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="منوی نرم‌افزار"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setDrawerOpen(false);
                  const menuButton =
                    menuButtonRef.current ??
                    document.querySelector<HTMLButtonElement>('button[aria-label="باز کردن منو"]');
                  menuButton?.focus();
                }
              }}
              className="fixed inset-0 z-40 lg:hidden"
            >
              <button
                type="button"
                aria-label="بستن منو"
                tabIndex={-1}
                aria-hidden="true"
                className="absolute inset-0 bg-black/60 focus:outline-none"
                onClick={() => setDrawerOpen(false)}
              />
              <div className="absolute inset-y-0 start-0 w-72 max-w-[85vw] overflow-y-auto overscroll-contain border-e border-border bg-background p-4 shadow-2xl">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="بستن منو"
                  className="absolute top-3 end-3 inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

          <CommandPalette open={paletteOpen} onOpenChange={handlePaletteOpenChange} mode={paletteMode} />
          <DropOverlay />
          <ClientErrorReporter />
        </div>
      </ImportHandoffProvider>
      </AccessProvider>
    </EnterpriseRouteGuard>
  );
}
