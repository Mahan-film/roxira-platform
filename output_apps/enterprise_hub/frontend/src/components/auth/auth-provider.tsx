"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";

import {
  AuthServiceDomain,
  AuthSession,
  AuthUser,
  clearStoredSession,
  inferServiceDomain,
  inferUiLocale,
  loadStoredSession,
  saveStoredSession,
  serverLogout,
  StoredAuthSession,
  toStoredSession,
  UiLocale,
} from "@/lib/api/auth-client";
import {
  accessNeedsRefresh,
  canRefresh,
  extractTenantIdFromToken,
  msUntilRefresh,
} from "@/lib/api/session-logic";
import { refreshStoredSession } from "@/lib/api/session-store";
import { getUnsyncedOfflineSalesCount } from "@/lib/pos-offline-db";
import { LoginModal } from "@/components/auth/login-modal";

interface OpenLoginOptions {
  serviceDomain?: AuthServiceDomain;
  title?: string;
  description?: string;
  /** پس از ورود موفق، یک‌بار فراخوانی می‌شود (برای ادامه اکشن‌های گیت‌شده). */
  onSuccess?: () => void;
  /** Language of the dialog. English (roxira.net) offers email + password only, no SMS. */
  locale?: UiLocale;
  /** Opens the sign-up form instead of sign-in (roxira.ir). */
  authMode?: "login" | "signup";
  /** Where to go after sign-in. Default for Roxira portal logins: `/app` (`/en/app` in English). */
  redirectTo?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginOpen: boolean;
  openLogin: (options?: OpenLoginOptions) => void;
  closeLogin: () => void;
  /** Sign out: revoke the refresh token on the server, then clear this device. */
  logout: () => void;
  /** Replace the current session (e.g. after the password changed and older sessions were revoked). */
  applySession: (session: AuthSession) => void;
  /** The session can no longer be renewed: clear it and open the login dialog. */
  expireSession: () => void;
  getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function subscribeToSession(onChange: () => void): () => void {
  window.addEventListener("roxira-auth-changed", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("roxira-auth-changed", onChange);
    window.removeEventListener("storage", onChange);
  };
}

// useSyncExternalStore needs a stable snapshot: re-read localStorage only when
// an auth event fired since the last read.
let sessionSnapshot: StoredAuthSession | null = null;
let sessionSnapshotStale = true;

function subscribeAndInvalidate(onChange: () => void): () => void {
  return subscribeToSession(() => {
    sessionSnapshotStale = true;
    onChange();
  });
}

// In-memory copy of the session for browsers where storage writes fail (Safari
// private mode, blocked site data). Only set when localStorage does not hold the
// session after a save, so a logout in another tab is never overridden.
let fallbackSession: StoredAuthSession | null = null;

function notifySessionChanged(): void {
  sessionSnapshotStale = true;
  // saveStoredSession/clearStoredSession only dispatch this when the storage
  // call succeeded, so fire it here to refresh subscribers either way.
  window.dispatchEvent(new Event("roxira-auth-changed"));
}

function persistSession(stored: StoredAuthSession): void {
  saveStoredSession(stored);
  fallbackSession = loadStoredSession() ? null : stored;
  notifySessionChanged();
}

function discardSession(): void {
  fallbackSession = null;
  clearStoredSession();
  notifySessionChanged();
}

function getSessionSnapshot(): StoredAuthSession | null {
  if (sessionSnapshotStale) {
    if (fallbackSession?.expiresAt && fallbackSession.expiresAt < Date.now()) {
      fallbackSession = null;
    }
    sessionSnapshot = loadStoredSession() ?? fallbackSession;
    sessionSnapshotStale = false;
  }
  return sessionSnapshot;
}

function getServerSessionSnapshot(): StoredAuthSession | null {
  return null;
}

const noopSubscribe = () => () => {};

export const SESSION_EXPIRED_MESSAGE = "نشست شما منقضی شد؛ دوباره وارد شوید";
export const SESSION_EXPIRED_MESSAGE_EN = "Your session has expired. Please sign in again.";

/** Landing page after a Roxira portal sign-in. */
function defaultRedirect(locale: UiLocale): string {
  return locale === "en" ? "/en/app" : "/app";
}

function isInsideApp(pathname: string): boolean {
  return /^\/(en\/)?app(\/|$)/.test(pathname);
}

/**
 * فراهم‌کننده وضعیت احراز هویت در سراسر رابط (هدر، چت‌بات قاضی و فرم‌های
 * فاکتور روکسیرا). سشن در localStorage نگه داشته می‌شود و مودال لاگین
 * به‌صورت سراسری از همین Provider رندر می‌گردد.
 *
 * Session lifetime (NestJS): 15-minute access token + 30-day rotating refresh
 * token. This provider renews the access token a minute before it expires and
 * when the tab becomes visible again; the user only sees the login dialog when
 * the refresh token is gone, expired or revoked. Smart Judge (Python) sessions
 * have no refresh token and end when their own access token expires.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const session = useSyncExternalStore(
    subscribeAndInvalidate,
    getSessionSnapshot,
    getServerSessionSnapshot,
  );
  // True during SSR and hydration, false once the client snapshot is in use.
  const isLoading = useSyncExternalStore(
    noopSubscribe,
    () => false,
    () => true,
  );
  const [loginOpen, setLoginOpen] = useState(false);
  const [modalOptions, setModalOptions] = useState<OpenLoginOptions>({});
  const router = useRouter();

  const pendingRef = useRef<(() => void) | null>(null);
  const redirectRef = useRef<string | null>(null);

  const openLogin = useCallback((options: OpenLoginOptions = {}) => {
    pendingRef.current = options.onSuccess ?? null;
    redirectRef.current = options.redirectTo ?? null;
    setModalOptions(options);
    setLoginOpen(true);
  }, []);

  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    pendingRef.current = null;
    redirectRef.current = null;
  }, []);

  const handleAuthenticated = useCallback(
    (authSession: AuthSession) => {
      const stored = toStoredSession(authSession);
      // Persists to localStorage and keeps an in-memory fallback if that fails.
      persistSession(stored);

      const callback = pendingRef.current;
      const explicitTarget = redirectRef.current;
      pendingRef.current = null;
      redirectRef.current = null;
      if (callback) {
        callback();
        return;
      }
      // Roxira portal sign-in lands on the panel; Smart Judge stays where it is.
      const portalLogin = authSession.user.serviceDomain === "ROXIRA";
      const target = explicitTarget ?? (portalLogin ? defaultRedirect(inferUiLocale()) : null);
      if (target && !(portalLogin && !explicitTarget && isInsideApp(window.location.pathname))) {
        router.push(target);
      }
    },
    [router],
  );

  const applySession = useCallback((authSession: AuthSession) => {
    persistSession(toStoredSession(authSession));
  }, []);

  const logout = useCallback(() => {
    const activeSession = loadStoredSession() ?? fallbackSession;
    const activeTenantId = extractTenantIdFromToken(activeSession?.accessToken);
    if (activeTenantId && typeof window !== "undefined") {
      const unsyncedCount = getUnsyncedOfflineSalesCount(activeTenantId);
      if (
        unsyncedCount > 0 &&
        !window.confirm(
          `شما ${unsyncedCount} فروش همگام‌نشده در صف آفلاین دارید. این فروش‌ها در مرورگر باقی می‌مانند اما تا ورود مجدد ارسال نخواهند شد. آیا از خروج اطمینان دارید؟`,
        )
      ) {
        return;
      }
    }
    const refreshToken = activeSession?.refreshToken;
    if (refreshToken) void serverLogout(refreshToken);
    discardSession();
  }, []);

  const expireSession = useCallback(() => {
    const wasPortal = inferServiceDomain() === "ROXIRA";
    const locale = inferUiLocale();
    discardSession();
    pendingRef.current = null;
    redirectRef.current = null;
    if (wasPortal) {
      setModalOptions({
        serviceDomain: "ROXIRA",
        locale,
        title: locale === "en" ? "Sign in" : "ورود به پورتال سازمانی روکسیرا",
        description: locale === "en" ? SESSION_EXPIRED_MESSAGE_EN : SESSION_EXPIRED_MESSAGE,
      });
    } else {
      setModalOptions({
        serviceDomain: "GHAZI",
        title: "ورود به قاضی هوشمند",
        description: SESSION_EXPIRED_MESSAGE,
      });
    }
    setLoginOpen(true);
  }, []);

  // Keep the access token fresh: renew shortly before it expires, and when the
  // tab wakes up (timers are throttled in background tabs).
  useEffect(() => {
    if (!session || !canRefresh(session)) return;
    let timer: number | undefined;
    let cancelled = false;
    const renew = async () => {
      const outcome = await refreshStoredSession();
      if (cancelled) return;
      if (outcome.status === "rejected") expireSession();
      else if (outcome.status === "unavailable") timer = window.setTimeout(renew, 30_000);
    };
    timer = window.setTimeout(renew, accessNeedsRefresh(session) ? 0 : msUntilRefresh(session));
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timer);
        timer = window.setTimeout(renew, 0);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session, expireSession]);

  const getAccessToken = useCallback(
    () => session?.accessToken ?? null,
    [session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      accessToken: session?.accessToken ?? null,
      isAuthenticated: Boolean(session?.accessToken),
      isLoading,
      loginOpen,
      openLogin,
      closeLogin,
      logout,
      applySession,
      expireSession,
      getAccessToken,
    }),
    [
      applySession,
      closeLogin,
      expireSession,
      getAccessToken,
      isLoading,
      loginOpen,
      logout,
      openLogin,
      session,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <LoginModal
        open={loginOpen}
        onClose={closeLogin}
        onAuthenticated={handleAuthenticated}
        serviceDomain={modalOptions.serviceDomain}
        locale={modalOptions.locale}
        authMode={modalOptions.authMode}
        title={modalOptions.title}
        description={modalOptions.description}
      />
    </AuthContext.Provider>
  );
}

/** دسترسی تایپ‌سیف به وضعیت احراز هویت. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth باید داخل AuthProvider استفاده شود.");
  }
  return context;
}
