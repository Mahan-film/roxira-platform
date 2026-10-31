"use client";

import { useState } from "react";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { describeAuthError } from "@/components/auth/password-auth-panel";
import { PASSWORD_AUTH_COPY } from "@/components/auth/password-auth-copy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type UiLocale, setAccountPassword } from "@/lib/api/auth-client";

const TEXT = {
  fa: {
    title: "رمز عبور و ورود با ایمیل",
    addIntro:
      "با افزودن ایمیل و رمز عبور، همین حساب را می‌توانید بدون پیامک هم باز کنید. اطلاعات و سازمان شما تغییری نمی‌کند.",
    changeIntro: "رمز عبور فعلی خود را تغییر دهید. بعد از تغییر، سایر دستگاه‌ها خارج می‌شوند.",
    current: "رمز عبور فعلی",
    next: "رمز عبور جدید",
    email: "ایمیل",
    username: "نام کاربری (اختیاری)",
    save: "ذخیره رمز عبور",
    done: "رمز عبور ذخیره شد. از این پس با ایمیل/نام کاربری و رمز عبور هم می‌توانید وارد شوید.",
    needIdentifier: "ایمیل یا نام کاربری را وارد کنید.",
    wrongCurrent: "رمز عبور فعلی درست نیست.",
  },
  en: {
    title: "Password",
    addIntro: "Add an email and password so you can also sign in without a text message. Your data and organization stay the same.",
    changeIntro: "Change your password. Other devices are signed out afterwards.",
    current: "Current password",
    next: "New password",
    email: "Email",
    username: "Username (optional)",
    save: "Save password",
    done: "Password saved.",
    needIdentifier: "Enter an email or a username.",
    wrongCurrent: "The current password is not correct.",
  },
} as const;

const INPUT = "h-10 border-white/10 bg-black/30 text-left text-slate-100";

/**
 * Account security card. An SMS-only user adds email/username + password here
 * (same account, same organization); a user with a password changes it.
 */
export function PasswordSettingsCard({ locale }: { locale: UiLocale }) {
  const { user, applySession } = useAuth();
  const tx = TEXT[locale];
  const t = PASSWORD_AUTH_COPY[locale];
  const hasPassword = Boolean(user?.hasPassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!user) return null;
  const needsIdentifier = !user.email && !user.username;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(false);
    if (needsIdentifier && !email.trim() && !username.trim()) return setError(tx.needIdentifier);
    if (next.length < 10) return setError(t.errPasswordShort);
    setLoading(true);
    try {
      const session = await setAccountPassword({
        newPassword: next,
        currentPassword: hasPassword ? current : undefined,
        email: needsIdentifier ? email.trim() || undefined : undefined,
        username: needsIdentifier ? username.trim() || undefined : undefined,
      });
      applySession(session);
      setCurrent("");
      setNext("");
      setDone(true);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      setError(status === 403 ? tx.wrongCurrent : describeAuthError(err, t, locale));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-card p-5" dir={locale === "fa" ? "rtl" : "ltr"}>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold">
        <KeyRound className="size-4 text-indigo-400" aria-hidden="true" />
        {tx.title}
      </h2>
      <p className="mb-4 text-xs leading-6 text-muted-foreground">{hasPassword ? tx.changeIntro : tx.addIntro}</p>
      <form onSubmit={submit} className="grid max-w-md gap-3" noValidate>
        {hasPassword && (
          <div className="space-y-1.5">
            <Label htmlFor="ps-current">{tx.current}</Label>
            <Input id="ps-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" dir="ltr" className={INPUT} />
          </div>
        )}
        {needsIdentifier && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="ps-email">{tx.email}</Label>
              <Input id="ps-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" dir="ltr" className={INPUT} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ps-username">{tx.username}</Label>
              <Input id="ps-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" dir="ltr" className={INPUT} />
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ps-next">{tx.next}</Label>
          <Input id="ps-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" dir="ltr" className={INPUT} />
          <p className="text-xs text-muted-foreground">{t.passwordHint}</p>
        </div>
        {done && (
          <p className="flex items-start gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
            {tx.done}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </p>
        )}
        <Button type="submit" disabled={loading} className="h-10 w-fit px-5">
          {loading ? <Loader2 className="size-4 animate-spin" /> : tx.save}
        </Button>
      </form>
    </section>
  );
}
