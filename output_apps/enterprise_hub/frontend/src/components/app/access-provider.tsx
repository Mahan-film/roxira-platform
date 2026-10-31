"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { loadStoredSession, saveStoredSession } from "@/lib/api/auth-client";
import { getMyAccess, switchOrganization } from "@/lib/api/access-client";
import type { AccessActionKey, AccessModuleKey, MyAccess } from "@/types/access";

type Org = MyAccess["organization"];

interface AccessContextValue {
  loading: boolean;
  error: string | null;
  /** Null when the person belongs to no organisation yet (or is not loaded). */
  org: Org;
  /** UX only: hides what is not allowed. The server decides every request. */
  can: (module: AccessModuleKey, action?: AccessActionKey) => boolean;
  /** Module bought by the organisation (core modules are always on). */
  hasModule: (module: AccessModuleKey) => boolean;
  reload: () => void;
}

const AccessContext = createContext<AccessContextValue | null>(null);

const CORE: AccessModuleKey[] = ["members", "security", "audit"];

/** Re-point this device's session at another organisation (membership is verified by the server), then reload the app. */
export async function switchToOrganization(tenantId: string, to = "/app"): Promise<void> {
  const res = await switchOrganization(tenantId);
  const stored = loadStoredSession();
  if (stored) {
    saveStoredSession({ ...stored, accessToken: res.accessToken, expiresAt: Date.now() + res.expiresIn * 1000 });
  }
  window.location.assign(to);
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, accessToken } = useAuth();
  const [org, setOrg] = useState<Org>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    const controller = new AbortController();
    getMyAccess(controller.signal)
      .then((res) => {
        setOrg(res.organization);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "خطا در دریافت دسترسی‌ها");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // accessToken changes when the organisation is switched or the token is renewed.
  }, [isAuthenticated, accessToken, tick]);

  const value = useMemo<AccessContextValue>(() => {
    const perms = new Set(org?.permissions ?? []);
    const entitled = new Set(org?.entitledModules ?? []);
    return {
      loading,
      error,
      org,
      can: (module, action = "read") =>
        Boolean(org) && perms.has(`${module}:${action}`) && (CORE.includes(module) || entitled.has(module)),
      hasModule: (module) => CORE.includes(module) || entitled.has(module),
      reload: () => setTick((n) => n + 1),
    };
  }, [org, loading, error]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error("useAccess must be used inside <AccessProvider>");
  return ctx;
}

/** Renders `children` only when the permission is held; otherwise `fallback` (default nothing). */
export function Can({
  module,
  action = "read",
  fallback = null,
  children,
}: {
  module: AccessModuleKey;
  action?: AccessActionKey;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { can, loading } = useAccess();
  if (loading) return null;
  return <>{can(module, action) ? children : fallback}</>;
}
