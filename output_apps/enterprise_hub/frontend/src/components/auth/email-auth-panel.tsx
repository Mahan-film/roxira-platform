"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type JudgeAuthSession,
  JudgeAuthError,
  isPlausibleEmail,
  loginWithEmail,
  registerWithEmail,
  requestPasswordReset,
  resendVerificationEmail,
} from "@/lib/api/judge-auth-client";

type Mode = "login" | "register" | "forgot";

const MIN_PASSWORD = 8;
const INPUT_CLASS = "h-11 border-white/10 bg-black/30 text-left text-slate-100 placeholder:text-slate-600";

interface EmailAuthPanelProps {
  onSession: (session: JudgeAuthSession) => void;
}

/**
 * ورود / ثبت‌نام با ایمیل و رمز عبور (برای کاربران بدون سیم‌کارت ایران).
 * هیچ رازی در مرورگر نگه‌داری نمی‌شود؛ تمام اعتبارسنجی نهایی سمت سرور است.
 */
export function EmailAuthPanel({ onSession }: EmailAuthPanelProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setNeedsVerification(false);
  };

  const run = async (work: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      if (err instanceof JudgeAuthError) {
        setError(err.details[0] ?? err.message);
        setNeedsVerification(err.statusCode === 403);
      } else {
        setError("اتصال به سرور برقرار نشد. دوباره تلاش کنید.");
      }
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isPlausibleEmail(email)) {
      setError("نشانی ایمیل نامعتبر است.");
      return;
    }
    if (mode !== "forgot" && password.length < MIN_PASSWORD) {
      setError(`رمز عبور باید حداقل ${MIN_PASSWORD.toLocaleString("fa-IR")} نویسه باشد.`);
      return;
    }
    void run(async () => {
      if (mode === "login") {
        onSession(await loginWithEmail(email, password));
      } else if (mode === "register") {
        await registerWithEmail(email, password, phone.trim() || null);
        setPassword("");
        setMode("login");
        setNotice(
          "برای فعال‌سازی حساب، پیوندی به ایمیل شما فرستاده شد (در صورت نیافتن، پوشهٔ اسپم را ببینید). پس از تأیید، وارد شوید.",
        );
      } else {
        setNotice(await requestPasswordReset(email));
      }
    });
  };

  const resend = () =>
    run(async () => {
      setNotice(await resendVerificationEmail(email));
      setNeedsVerification(false);
    });

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="auth-email" className="text-slate-300">
          ایمیل
        </Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
          <Input
            id="auth-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
            dir="ltr"
            maxLength={254}
            className={`${INPUT_CLASS} pr-10`}
          />
        </div>
      </div>

      {mode !== "forgot" && (
        <div className="space-y-2">
          <Label htmlFor="auth-password" className="text-slate-300">
            رمز عبور
          </Label>
          <Input
            id="auth-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            dir="ltr"
            maxLength={128}
            className={INPUT_CLASS}
          />
          {mode === "register" && (
            <p className="text-xs text-slate-500">حداقل ۸ نویسه.</p>
          )}
        </div>
      )}

      {mode === "register" && (
        <div className="space-y-2">
          <Label htmlFor="auth-email-phone" className="text-slate-300">
            شماره همراه (اختیاری)
          </Label>
          <Input
            id="auth-email-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="09xxxxxxxxx"
            inputMode="numeric"
            autoComplete="tel"
            dir="ltr"
            className={INPUT_CLASS}
          />
          <p className="text-xs text-slate-500">
            فقط برای تماس ذخیره می‌شود و برای ورود استفاده نمی‌شود.
          </p>
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
      {needsVerification && (
        <Button
          type="button"
          variant="outline"
          disabled={loading}
          onClick={() => void resend()}
          className="h-10 w-full border-white/10 bg-transparent text-slate-200"
        >
          ارسال مجدد ایمیل تأیید
        </Button>
      )}

      <Button
        type="submit"
        disabled={loading}
        className="h-11 w-full bg-[#fbbf24] font-bold text-[#05080f] hover:bg-[#f59e0b]"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : mode === "login" ? (
          "ورود"
        ) : mode === "register" ? (
          "ثبت‌نام"
        ) : (
          "ارسال پیوند بازیابی"
        )}
      </Button>

      <div className="flex items-center justify-between text-xs">
        {mode === "login" ? (
          <>
            <button type="button" onClick={() => switchMode("register")} className="text-[#38bdf8] hover:underline">
              حساب ندارید؟ ثبت‌نام
            </button>
            <button type="button" onClick={() => switchMode("forgot")} className="text-[#38bdf8] hover:underline">
              فراموشی رمز
            </button>
          </>
        ) : (
          <button type="button" onClick={() => switchMode("login")} className="text-[#38bdf8] hover:underline">
            بازگشت به ورود
          </button>
        )}
      </div>
    </form>
  );
}
