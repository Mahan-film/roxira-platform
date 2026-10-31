"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { describeAuthError } from "@/components/auth/password-auth-panel";
import { PASSWORD_AUTH_COPY } from "@/components/auth/password-auth-copy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type UiLocale, resetPasswordWithToken } from "@/lib/api/auth-client";

const TEXT = {
  fa: {
    title: "تعیین رمز عبور جدید",
    next: "رمز عبور جدید",
    save: "ذخیره رمز عبور",
    done: "رمز عبور تغییر کرد. اکنون با رمز جدید وارد شوید.",
    signIn: "ورود",
    badLink: "این پیوند نامعتبر است. دوباره درخواست بازیابی بدهید.",
    expired: "این پیوند نامعتبر یا منقضی شده است. دوباره درخواست بازیابی بدهید.",
  },
  en: {
    title: "Choose a new password",
    next: "New password",
    save: "Save password",
    done: "Your password was changed. Sign in with the new password.",
    signIn: "Sign in",
    badLink: "This link is not valid. Request a new reset email.",
    expired: "This reset link is invalid or has expired. Request a new one.",
  },
} as const;

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const locale: UiLocale = params.get("lang") === "en" ? "en" : "fa";
  const tx = TEXT[locale];
  const t = PASSWORD_AUTH_COPY[locale];
  const { openLogin } = useAuth();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(token.length < 20 ? tx.badLink : null);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 10) return setError(t.errPasswordShort);
    setLoading(true);
    try {
      await resetPasswordWithToken(token, password);
      setDone(true);
      // The token is in the address bar: drop it so it is not kept in history.
      window.history.replaceState(null, "", window.location.pathname);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      const message = describeAuthError(err, t, locale);
      setError(status === 400 && /invalid or has expired/i.test(message) ? tx.expired : message);
    } finally {
      setLoading(false);
    }
  };

  const signIn = () =>
    openLogin({
      serviceDomain: "ROXIRA",
      locale,
      title: locale === "en" ? "Sign in to Roxira" : "ورود به پورتال سازمانی روکسیرا",
    });

  return (
    <div className="dark flex min-h-full flex-1 items-center justify-center bg-background px-4 py-16 text-foreground" dir={locale === "fa" ? "rtl" : "ltr"}>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-card p-6">
        <h1 className="mb-4 text-lg font-bold">{tx.title}</h1>
        {done ? (
          <div className="space-y-4">
            <p className="flex items-start gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              {tx.done}
            </p>
            <Button onClick={signIn} className="h-10 w-full">{tx.signIn}</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="rp-password">{tx.next}</Label>
              <Input id="rp-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" dir="ltr" maxLength={128} className="h-11 border-white/10 bg-black/30 text-left" />
              <p className="text-xs text-muted-foreground">{t.passwordHint}</p>
            </div>
            {error && (
              <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>
            )}
            <Button type="submit" disabled={loading || token.length < 20} className="h-11 w-full">
              {loading ? <Loader2 className="size-4 animate-spin" /> : tx.save}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
