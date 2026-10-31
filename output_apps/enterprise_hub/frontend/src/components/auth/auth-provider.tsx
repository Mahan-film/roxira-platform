"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  AuthServiceDomain,
  AuthSession,
  AuthUser,
  clearStoredSession,
  inferServiceDomain,
  loadStoredSession,
  saveStoredSession,
  StoredAuthSession,
  toStoredSession,
} from "@/lib/api/auth-client";
import { LoginModal } from "@/components/auth/login-modal";

interface OpenLoginOptions {
  serviceDomain?: AuthServiceDomain;
  title?: string;
  description?: string;
  /** پس از ورود موفق، یک‌بار فراخوانی می‌شود (برای ادامه اکشن‌های گیت‌شده). */
  onSuccess?: () => void;
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginOpen: boolean;
  openLogin: (options?: OpenLoginOptions) => void;
  closeLogin: () => void;
  logout: () => void;
  /** Server answered 401 (token expired, sessions last 3 days): clear the session and open the login dialog. */
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

/**
 * فراهم‌کننده وضعیت احراز هویت در سراسر رابط (هدر، چت‌بات قاضی و فرم‌های
 * فاکتور روکسیرا). سشن در localStorage نگه داشته می‌شود و مودال لاگین
 * به‌صورت سراسری از همین Provider رندر می‌گردد.
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

  const pendingRef = useRef<(() => void) | null>(null);

  const openLogin = useCallback((options: OpenLoginOptions = {}) => {
    pendingRef.current = options.onSuccess ?? null;
    setModalOptions(options);
    setLoginOpen(true);
  }, []);

  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    pendingRef.current = null;
  }, []);

  const handleAuthenticated = useCallback((authSession: AuthSession) => {
    const stored = toStoredSession(authSession);
    // Persists to localStorage and keeps an in-memory fallback if that fails.
    persistSession(stored);

    const callback = pendingRef.current;
    pendingRef.current = null;
    if (callback) {
      callback();
    }
  }, []);

  const logout = useCallback(() => {
    discardSession();
  }, []);

  const expireSession = useCallback(() => {
    discardSession();
    pendingRef.current = null;
    const serviceDomain = inferServiceDomain();
    setModalOptions({
      serviceDomain,
      title: serviceDomain === "GHAZI" ? "ورود به قاضی هوشمند" : "ورود به حساب روکسیرا",
      description: SESSION_EXPIRED_MESSAGE,
    });
    setLoginOpen(true);
  }, []);

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
      expireSession,
      getAccessToken,
    }),
    [
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
