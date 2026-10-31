"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Clock, LogOut } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { PasswordSettingsCard } from "@/components/auth/password-settings-card";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api/http-client";
import { getMyTenant } from "@/lib/api/tenants-client";
import type { TenantMe } from "@/types/tenants";

/**
 * Modules of the Iranian suite. They depend on Jalali dates, Rial accounting
 * and the Iranian tax authority, so they are NOT offered on roxira.net yet.
 * Shown as unavailable on purpose instead of linking to Persian pages.
 */
const IRAN_ONLY_MODULES = [
  "Invoicing (Iranian tax format)",
  "Accounting (Jalali calendar, Rial)",
  "Payroll and HR (Iranian labour law)",
  "Tax authority reporting (Moodian)",
  "CRM and inventory (Persian interface)",
];

export default function EnglishPanelPage() {
  const { user, isAuthenticated, isLoading, openLogin, logout } = useAuth();
  const [tenant, setTenant] = useState<TenantMe | null>(null);
  const [tenantError, setTenantError] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    const controller = new AbortController();
    getMyTenant(controller.signal)
      .then(setTenant)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTenantError(error instanceof ApiClientError || error instanceof Error);
      });
    return () => controller.abort();
  }, [isAuthenticated]);

  const signIn = () =>
    openLogin({
      serviceDomain: "ROXIRA",
      locale: "en",
      title: "Sign in to Roxira",
      description: "Sign in or create an account with your email and a password.",
    });

  if (isLoading) {
    return (
      <div className="dark flex min-h-full flex-1 items-center justify-center bg-background text-foreground" dir="ltr">
        <p className="text-sm text-muted-foreground" role="status">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="dark flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-background px-4 py-16 text-center text-foreground" dir="ltr">
        <h1 className="text-xl font-bold">Sign in to your Roxira account</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Use your email or username and password. New here? Create an account in the same dialog.
        </p>
        <Button onClick={signIn} className="h-11 px-6">Sign in or create account</Button>
        <Link href="/" className="text-xs text-muted-foreground hover:underline">Back to roxira.net</Link>
      </div>
    );
  }

  const name = user?.displayName || user?.username || user?.email || "your account";

  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground" dir="ltr">
      <header className="border-b border-white/10 bg-[#020617]/90">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 text-sm font-bold text-white">
            <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-black">R</span>
            Roxira International
          </Link>
          <Button variant="outline" onClick={logout} className="h-9 gap-1.5 border-white/15 bg-transparent text-xs">
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-xl font-bold">Welcome, {name}</h1>
          {user?.email && user.username && <p className="text-xs text-muted-foreground">{user.email}</p>}
        </div>

        <section className="rounded-2xl border border-white/10 bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
            <Building2 className="size-4 text-indigo-400" aria-hidden="true" />
            Organization
          </h2>
          {tenant ? (
            <dl className="grid gap-1 text-sm">
              <div className="flex gap-2"><dt className="text-muted-foreground">Name</dt><dd>{tenant.name}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground">Your role</dt><dd>{tenant.tenantRole === "OWNER" ? "Owner" : "Member"}</dd></div>
            </dl>
          ) : tenantError ? (
            <p className="text-xs text-muted-foreground">Your organization could not be loaded. Try again shortly.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Loading…</p>
          )}
        </section>

        <PasswordSettingsCard locale="en" />

        <section className="rounded-2xl border border-white/10 bg-card p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-bold">
            <Clock className="size-4 text-amber-400" aria-hidden="true" />
            Not available on roxira.net yet
          </h2>
          <p className="mb-3 text-xs leading-6 text-muted-foreground">
            These modules are built for Iran (Jalali calendar, Rial, Iranian tax rules) and run on roxira.ir. We will enable the international versions as they are ready.
          </p>
          <ul className="grid gap-1.5 text-sm text-muted-foreground">
            {IRAN_ONLY_MODULES.map((item) => (
              <li key={item} className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2 opacity-70">
                <span>{item}</span>
                <span className="text-[11px] uppercase tracking-wide">Iran only</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
