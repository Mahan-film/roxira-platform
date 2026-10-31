"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type AuthSession,
  type UiLocale,
  completeMfaLogin,
  isMfaChallenge,
  passwordLogin,
  passwordSignup,
  requestPasswordResetEmail,
} from "@/lib/api/auth-client";
import { ApiClientError } from "@/lib/api/http-client";
import { PASSWORD_AUTH_COPY, type PasswordAuthCopy } from "@/components/auth/password-auth-copy";

type Mode = "login" | "signup" | "forgot";

const MIN_PASSWORD = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/;
const INPUT_CLASS = "h-11 border-white/10 bg-black/30 text-left text-slate-100 placeholder:text-slate-600";

interface PasswordAuthPanelProps {
  locale: UiLocale;
  onSession: (session: AuthSession) => void;
  initialMode?: Mode;
  /** Invitation token: signing up joins that organisation, so no organisation name is asked. */
  inviteToken?: string;
}

/** Turn an API failure into a user-facing sentence in the portal language. */
export function describeAuthError(err: unknown, t: PasswordAuthCopy, locale: UiLocale): string {
  if (!(err instanceof ApiClientError)) return t.errNetwork;
  if (err.statusCode === 0) return t.errNetwork;
  if (err.statusCode === 401) return t.errInvalidLogin;
  if (err.statusCode === 429) return t.errRateLimit;
  if (err.statusCode === 409) return t.errUnavailable;
  if (err.statusCode >= 500) return t.errServer;
  // 400: validation text from the server. English users read it as is; Persian
  // users get it only for rules the form cannot pre-check (e.g. common passwords).
  return locale === "en" || err.details.length > 0 ? err.details.join(" ") : t.errServer;
}

/**
 * Sign in / sign up / password reset with email-or-username and a password.
 * Works for both portals (Persian on roxira.ir, English on roxira.net).
 * Nothing secret is stored here; the server enforces every rule.
 */
export function PasswordAuthPanel({ locale, onSession, initialMode = "login", inviteToken }: PasswordAuthPanelProps) {
  const t = PASSWORD_AUTH_COPY[locale];
  const rtl = locale === "fa";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Set when the account has an authenticator app: the code is the second step. */
  const [challenge, setChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (challenge) {
      setLoading(true);
      try {
        onSession(await completeMfaLogin(challenge, mfaCode.trim()));
      } catch {
        setError(t.errMfa);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === "login" || mode === "forgot") {
      if (identifier.trim().length < 3) return setError(t.errIdentifier);
    }
    if (mode === "login" && password.length === 0) return setError(t.errInvalidLogin);
    if (mode === "signup") {
      if (!EMAIL_RE.test(email.trim())) return setError(t.errEmail);
      if (username.trim() && !USERNAME_RE.test(username.trim().toLowerCase())) return setError(t.errUsername);
      if (password.length < MIN_PASSWORD) return setError(t.errPasswordShort);
    }

    setLoading(true);
    try {
      if (mode === "login") {
        const result = await passwordLogin(identifier.trim(), password);
        if (isMfaChallenge(result)) setChallenge(result.challenge);
        else onSession(result);
      } else if (mode === "signup") {
        const result = await passwordSignup({
          email: email.trim(),
          username: username.trim() || undefined,
          password,
          organizationName: inviteToken ? undefined : organization.trim() || undefined,
          inviteToken,
        });
        if (isMfaChallenge(result)) setChallenge(result.challenge);
        else onSession(result);
      } else {
        await requestPasswordResetEmail(identifier.trim(), locale);
        setNotice(t.forgotNotice);
      }
    } catch (err) {
      setError(describeAuthError(err, t, locale));
    } finally {
      setLoading(false);
    }
  };

  const label = "text-slate-300";

  if (challenge) {
    return (
      <form onSubmit={submit} className="space-y-4" noValidate dir={rtl ? "rtl" : "ltr"} aria-label={t.mfaTitle}>
        <h3 className="text-sm font-bold text-slate-100">{t.mfaTitle}</h3>
        <p className="text-xs text-slate-400">{t.mfaHint}</p>
        <div className="space-y-2">
          <Label htmlFor="pw-mfa" className={label}>{t.mfaCode}</Label>
          <Input
            id="pw-mfa"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode="text"
            dir="ltr"
            maxLength={20}
            autoFocus
            className={INPUT_CLASS}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </p>
        )}
        <Button type="submit" disabled={loading || mfaCode.trim().length < 6} className="h-11 w-full bg-[#0071e3] font-bold text-white hover:bg-[#0077ed]">
          {loading ? <Loader2 className="size-4 animate-spin" /> : t.mfaSubmit}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate dir={rtl ? "rtl" : "ltr"}>
      {mode === "signup" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="pw-email" className={label}>{t.email}</Label>
            <div className="relative">
              <Mail className={`pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-slate-500 ${rtl ? "right-3" : "left-3"}`} />
              <Input
                id="pw-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.identifierPlaceholder}
                autoComplete="email"
                dir="ltr"
                maxLength={254}
                autoFocus
                className={`${INPUT_CLASS} ${rtl ? "pr-10" : "pl-10"}`}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-username" className={label}>{t.username}</Label>
            <Input
              id="pw-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              dir="ltr"
              maxLength={32}
              className={INPUT_CLASS}
            />
            <p className="text-xs text-slate-500">{t.usernameHint}</p>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="pw-identifier" className={label}>{t.identifier}</Label>
          <Input
            id="pw-identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={t.identifierPlaceholder}
            autoComplete="username"
            dir="ltr"
            maxLength={254}
            autoFocus
            className={INPUT_CLASS}
          />
        </div>
      )}

      {mode !== "forgot" && (
        <div className="space-y-2">
          <Label htmlFor="pw-password" className={label}>{t.password}</Label>
          <Input
            id="pw-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            dir="ltr"
            maxLength={128}
            className={INPUT_CLASS}
          />
          {mode === "signup" && <p className="text-xs text-slate-500">{t.passwordHint}</p>}
        </div>
      )}

      {mode === "signup" && inviteToken && (
        <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-200">{t.inviteNote}</p>
      )}
      {mode === "signup" && !inviteToken && (
        <div className="space-y-2">
          <Label htmlFor="pw-org" className={label}>{t.organization}</Label>
          <Input
            id="pw-org"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            maxLength={150}
            className={`${INPUT_CLASS} ${rtl ? "text-right" : ""}`}
          />
          <p className="text-xs text-slate-500">{t.organizationHint}</p>
        </div>
      )}

      {notice && (
        <p className="flex items-start gap-1.5 rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={loading}
        className="h-11 w-full bg-[#0071e3] font-bold text-white hover:bg-[#0077ed]"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : mode === "login" ? (
          t.login
        ) : mode === "signup" ? (
          t.signup
        ) : (
          t.forgotSubmit
        )}
      </Button>

      <div className="flex items-center justify-between text-xs">
        {mode === "login" ? (
          <>
            <button type="button" onClick={() => switchMode("signup")} className="text-sky-300 hover:underline">
              {t.toSignup}
            </button>
            <button type="button" onClick={() => switchMode("forgot")} className="text-sky-300 hover:underline">
              {t.toForgot}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => switchMode("login")} className="text-sky-300 hover:underline">
            {t.toLogin}
          </button>
        )}
      </div>
    </form>
  );
}
