"use client";

/**
 * Owner admin console (/admin on roxira.ir). Persian, RTL, dark `.ghazi-theme` (navy / gold / cyan), mobile first.
 *
 * Protection is on the SERVER: every call goes to /api/v1/apps/judge/admin/console/*, which requires a valid
 * login token whose phone is in SMARTJUDGE_ADMIN_PHONES (401 / 403 otherwise), is rate limited, and validates
 * every body. This page only signs in with the normal SMS flow and renders what the API returns.
 * Docs: docs/ops/ADMIN_CONSOLE.md.
 */
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AdminApiError, adminGet, clearAdminToken, downloadDataset, hasAdminToken, subscribeAdminToken } from "@/lib/api/admin-console-client";
import { AgentsTab } from "@/components/admin/agents-tab";
import { Btn, Notice, Spinner } from "@/components/admin/admin-ui";
import { DashboardTab } from "@/components/admin/dashboard-tab";
import { HealthTab } from "@/components/admin/health-tab";
import { LoginGate } from "@/components/admin/login-gate";
import { MarketingTab } from "@/components/admin/marketing-tab";
import { ModelsTab } from "@/components/admin/models-tab";
import { PaymentsTab } from "@/components/admin/payments-tab";
import { UsersTab } from "@/components/admin/users-tab";

const TABS = [
  { id: "dashboard", label: "داشبورد" },
  { id: "users", label: "کاربران و اشتراک‌ها" },
  { id: "payments", label: "پرداخت‌ها" },
  { id: "models", label: "مدل‌ها و هزینه" },
  { id: "agents", label: "پژوهش و ایجنت‌ها" },
  { id: "marketing", label: "بازاریابی" },
  { id: "health", label: "سلامت سیستم" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function AdminConsolePage() {
  // token presence is an external store (sessionStorage): no effect-driven setState needed for it
  const hasToken = useSyncExternalStore(subscribeAdminToken, hasAdminToken, () => false);
  const [admin, setAdmin] = useState<string | null>(null);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<TabId>("dashboard");
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const signOut = useCallback((why?: string) => {
    setAdmin(null);
    setReason(why);
    clearAdminToken();
  }, []);

  // Ask the server who we are once a token exists; the server decides whether this phone is an admin.
  useEffect(() => {
    if (!hasToken || admin !== null) return;
    let cancelled = false;
    adminGet<{ admin: string }>("/me")
      .then((me) => {
        if (!cancelled) {
          setReason(undefined);
          setAdmin(me.admin);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof AdminApiError && (e.status === 401 || e.status === 403)) {
          signOut(e.status === 403 ? "این شماره دسترسی مدیر ندارد." : "نشست منقضی شده؛ دوباره وارد شوید.");
        } else {
          signOut(e instanceof Error ? e.message : "خطای اتصال");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasToken, admin, signOut]);

  const session: "out" | "checking" | "in" = !hasToken ? "out" : admin === null ? "checking" : "in";

  const authLost = useCallback(() => signOut("نشست منقضی شده؛ دوباره وارد شوید."), [signOut]);

  async function dataset() {
    setDownloadError(null);
    try {
      await downloadDataset();
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "دانلود ناموفق بود.");
    }
  }

  return (
    <div className="dark ap-theme ghazi-theme min-h-dvh" data-theme="dark" dir="rtl" lang="fa">
      <header className="sticky top-0 z-20 border-b border-[var(--gh-border)] bg-[var(--ap-nav-bg)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4">
          <div>
            <h1 className="text-base font-bold text-[var(--gh-gold)] sm:text-lg">کنسول مدیریت روکسیرا</h1>
            {session === "in" && <p className="text-[11px] text-[var(--gh-muted)]">مدیر: <span dir="ltr">{admin}</span></p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/mission-control" className="text-xs text-[var(--gh-cyan)] underline">مرکز فرماندهی کارخانه</Link>
            <Link href="/" className="text-xs text-[var(--gh-cyan)] underline">سایت</Link>
            {session === "in" && (
              <>
                <Btn small variant="ghost" onClick={() => void dataset()}>دیتاست چت‌ها</Btn>
                <Btn small variant="ghost" onClick={() => signOut()}>خروج</Btn>
              </>
            )}
          </div>
        </div>
        {session === "in" && (
          <nav className="mx-auto max-w-6xl overflow-x-auto px-2" aria-label="بخش‌های کنسول">
            <div role="tablist" className="flex min-w-max gap-1 pb-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`min-h-11 whitespace-nowrap rounded-xl border px-3 text-sm transition-colors ${
                    tab === t.id
                      ? "border-[var(--gh-gold)] bg-[var(--gh-surface-2)] font-semibold text-[var(--gh-gold)]"
                      : "border-transparent text-[var(--gh-muted)] hover:text-[var(--gh-text)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4">
        {downloadError && <div className="mb-3"><Notice tone="danger">{downloadError}</Notice></div>}
        {session === "checking" && <Spinner label="در حال بررسی نشست…" />}
        {session === "out" && <LoginGate reason={reason} onSignedIn={() => setReason(undefined)} />}
        {session === "in" && (
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "dashboard" && <DashboardTab onAuthLost={authLost} />}
            {tab === "users" && <UsersTab onAuthLost={authLost} />}
            {tab === "payments" && <PaymentsTab onAuthLost={authLost} />}
            {tab === "models" && <ModelsTab onAuthLost={authLost} />}
            {tab === "agents" && <AgentsTab onAuthLost={authLost} />}
            {tab === "marketing" && <MarketingTab onAuthLost={authLost} />}
            {tab === "health" && <HealthTab onAuthLost={authLost} />}
          </div>
        )}
      </main>
    </div>
  );
}
