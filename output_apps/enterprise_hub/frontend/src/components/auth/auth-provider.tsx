"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AuthServiceDomain,
  AuthSession,
  AuthUser,
  clearStoredSession,
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
  getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * فراهم‌کننده وضعیت احراز هویت در سراسر رابط (هدر، چت‌بات قاضی و فرم‌های
 * فاکتور روکسیرا). سشن در localStorage نگه داشته می‌شود و مودال لاگین
 * به‌صورت سراسری از همین Provider رندر می‌گردد.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [modalOptions, setModalOptions] = useState<OpenLoginOptions>({});

  const pendingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setSession(loadStoredSession());
    setIsLoading(false);

    const sync = () => setSession(loadStoredSession());
    window.addEventListener("roxira-auth-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("roxira-auth-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

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
    saveStoredSession(stored);
    setSession(stored);

    const callback = pendingRef.current;
    pendingRef.current = null;
    if (callback) {
      callback();
    }
  }, []);

  const logout = useCallback(() => {
    clearStoredSession();
    setSession(null);
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
      getAccessToken,
    }),
    [
      closeLogin,
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
