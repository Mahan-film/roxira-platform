"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, KeyRound, Loader2, LogOut, ShieldCheck, X } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  loadStoredSession,
  saveStoredSession,
  toStoredSession,
} from "@/lib/api/auth-client";
import {
  isPlatformAuthenticatorAvailable,
  isWebAuthnSupported,
  loginWithPasskey,
} from "@/lib/api/webauthn-client";
import { ApiClientError } from "@/lib/api/http-client";

/**
 * دکمه ورود امن با Passkey (WebAuthn) برای پورتال بین‌المللی roxira.net.
 * در صورت پشتیبانی مرورگر، امکان ورود بیومتریک/سخت‌افزاری را فراهم می‌کند.
 */
export function PasskeyLoginButton() {
  const { user, isAuthenticated, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [platformAvailable, setPlatformAvailable] = useState(false);

  useEffect(() => {
    setSupported(isWebAuthnSupported());
    void isPlatformAuthenticatorAvailable().then(setPlatformAvailable);
  }, []);

  const handleLogin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await loginWithPasskey(phone.trim() || undefined);
      saveStoredSession(toStoredSession(session));
      setOpen(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.details.join(" | "));
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Passkey sign-in failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [phone]);

  if (!supported) {
    return null;
  }

  if (isAuthenticated && user) {
    const stored = loadStoredSession();
    return (
      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 sm:inline-flex">
          <ShieldCheck className="size-3.5" />
          {stored?.user.phone ?? user.phone}
        </span>
        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300 transition-colors hover:border-rose-400/40 hover:text-white"
        >
          <LogOut className="size-3.5" />
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs font-bold text-indigo-200 transition-colors hover:border-indigo-400/60 hover:text-white"
      >
        <Fingerprint className="size-3.5" />
        Passkey
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-[60] w-72 rounded-2xl border border-white/10 bg-[#0B111F] p-4 text-slate-100 shadow-2xl shadow-black/50">
          <div className="mb-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-sm font-bold text-white">
              <KeyRound className="size-4 text-indigo-300" />
              Secure Passkey sign-in
            </span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="flex size-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>

          <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
            {platformAvailable
              ? "Use your device biometrics (Touch ID / Windows Hello) or a hardware security key."
              : "Use a hardware security key or a synced passkey."}
          </p>

          <label className="mb-2 block text-[11px] font-semibold text-slate-300">
            Phone number (optional)
          </label>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="09xxxxxxxxx"
            inputMode="numeric"
            dir="ltr"
            className="mb-3 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-400/50 focus:outline-none"
          />

          {error && (
            <p className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={() => void handleLogin()}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition-opacity hover:opacity-95 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Waiting for authenticator...
              </>
            ) : (
              <>
                <Fingerprint className="size-4" />
                Continue with Passkey
              </>
            )}
          </button>

          <p className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-slate-500">
            <ShieldCheck className="size-3" />
            Phishing-resistant WebAuthn / FIDO2
          </p>
        </div>
      )}
    </div>
  );
}
