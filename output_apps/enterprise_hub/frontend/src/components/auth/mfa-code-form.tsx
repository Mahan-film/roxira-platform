"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AuthSession, type UiLocale, completeMfaLogin } from "@/lib/api/auth-client";
import { PASSWORD_AUTH_COPY } from "@/components/auth/password-auth-copy";

/** Second sign-in step for accounts with an authenticator app (used after SMS sign-in). */
export function MfaCodeForm({
  locale,
  challenge,
  onSession,
}: {
  locale: UiLocale;
  challenge: string;
  onSession: (session: AuthSession) => void;
}) {
  const t = PASSWORD_AUTH_COPY[locale];
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      onSession(await completeMfaLogin(challenge, code.trim()));
    } catch {
      setError(t.errMfa);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" dir={locale === "fa" ? "rtl" : "ltr"} aria-label={t.mfaTitle}>
      <h3 className="text-sm font-bold text-slate-100">{t.mfaTitle}</h3>
      <p className="text-xs text-slate-400">{t.mfaHint}</p>
      <div className="space-y-2">
        <Label htmlFor="mfa-code" className="text-slate-300">{t.mfaCode}</Label>
        <Input
          id="mfa-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          dir="ltr"
          maxLength={20}
          autoFocus
          className="h-11 border-white/10 bg-black/30 text-left text-slate-100"
        />
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      )}
      <Button type="submit" disabled={loading || code.trim().length < 6} className="h-11 w-full bg-[#0071e3] font-bold text-white hover:bg-[#0077ed]">
        {loading ? <Loader2 className="size-4 animate-spin" /> : t.mfaSubmit}
      </Button>
    </form>
  );
}
