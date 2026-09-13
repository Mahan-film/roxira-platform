"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Lock,
  Phone,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthServiceDomain, AuthSession } from "@/lib/api/auth-client";
import {
  JudgeAuthError,
  isValidIranianMobile,
  normalizeOtpCode,
  normalizePhone,
  sendJudgeOtp,
  verifyJudgeOtp,
} from "@/lib/api/judge-auth-client";
import { cn } from "@/lib/utils";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: (session: AuthSession) => void;
  serviceDomain?: AuthServiceDomain;
  title?: string;
  description?: string;
}

/**
 * مودال ورود پیامکی سامانه قاضی هوشمند.
 *
 * جریان دو مرحله‌ای (PHONE → OTP):
 *   ۱) ورود شماره همراه ایران (09xxxxxxxxx) و ارسال کد ۵ رقمی
 *   ۲) ورود کد و صدور سشن JWT
 *
 * نکتهٔ حیاتی: فراخوانی‌ها مستقیماً و «فقط» از طریق
 * `judge-auth-client` به مسیر `/api/v1/apps/judge/auth/send-otp` انجام
 * می‌شود؛ شماره همراه پیش از ارسال نرمال‌سازی می‌گردد (ارقام فارسی/عربی →
 * ASCII) و پس از دریافت پاسخ موفق، مرحلهٔ رابط به‌صورت خودکار به ورود کد
 * منتقل می‌شود.
 */
export function LoginModal({
  open,
  onClose,
  onAuthenticated,
  serviceDomain,
  title = "ورود به سامانه",
  description = "شماره همراه خود را وارد کنید؛ کد تأیید ۵ رقمی پیامک می‌شود.",
}: LoginModalProps) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [smsDelivered, setSmsDelivered] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("phone");
    setCode("");
    setError(null);
    setNotice(null);
    setDevCode(null);
    setResendIn(0);
    setSmsDelivered(null);
  }, [open]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => {
      setResendIn((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  const handleClose = useCallback(() => {
    if (loading) return;
    onClose();
  }, [loading, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose, open]);

  const requestCode = useCallback(async (targetPhone: string) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setDevCode(null);
    try {
      const response = await sendJudgeOtp(targetPhone);

      // پاسخ موفق → انتقال قطعی رابط به حالت ورود کد تأیید
      setPhone(targetPhone);
      setStep("code");
      setCode("");
      setResendIn(response.expiresIn || 120);
      setSmsDelivered(response.deliveryConfirmed);
      setDevCode(response.devCode);
      setNotice(
        response.deliveryConfirmed
          ? "کد تأیید ارسال شد. تا ۲ دقیقه اعتبار دارد."
          : "کد تأیید صادر شد؛ در صورت عدم دریافت پیامک، چند لحظه بعد دوباره درخواست کنید.",
      );
    } catch (err) {
      if (err instanceof JudgeAuthError) {
        setError(err.details);
      } else {
        setError(["ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کنید."]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSend = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const normalized = normalizePhone(phone);
      if (!isValidIranianMobile(normalized)) {
        setError(["شماره همراه باید با فرمت 09xxxxxxxxx و ۱۱ رقم باشد."]);
        return;
      }
      setPhone(normalized);
      await requestCode(normalized);
    },
    [phone, requestCode],
  );

  const handleVerify = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const cleanCode = normalizeOtpCode(code);
      if (cleanCode.length < 4) {
        setError(["کد تأیید باید ۵ رقم باشد."]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const session = await verifyJudgeOtp(phone, cleanCode);
        onAuthenticated({
          tokenType: session.tokenType,
          accessToken: session.accessToken,
          expiresIn: session.expiresIn,
          user: {
            id: session.user.id,
            phone: session.user.phone,
            displayName: session.user.displayName,
            email: session.user.email,
            role: "USER",
            serviceDomain: serviceDomain ?? "GHAZI",
            createdAt: new Date().toISOString(),
          },
        });
        onClose();
      } catch (err) {
        if (err instanceof JudgeAuthError) {
          setError(err.details);
        } else {
          setError(["تأیید کد ناموفق بود. لطفاً دوباره تلاش کنید."]);
        }
      } finally {
        setLoading(false);
      }
    },
    [code, onAuthenticated, onClose, phone, serviceDomain],
  );

  if (!open) return null;

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="بستن"
        onClick={handleClose}
        className="absolute inset-0 cursor-default bg-slate-950/70 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0B111F] text-slate-100 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-600/30">
              <Lock className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-white">{title}</h2>
              <p className="text-[10px] text-slate-400">
                {serviceDomain === "ROXIRA" ? "پورتال سازمانی روکسیرا" : "قاضی هوشمند"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="بستن مودال"
            className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-5">
          <p className="mb-4 text-xs leading-relaxed text-slate-400">{description}</p>

          {step === "phone" ? (
            <form onSubmit={handleSend} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="auth-phone" className="text-slate-300">
                  شماره همراه
                </Label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="auth-phone"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="09xxxxxxxxx"
                    inputMode="numeric"
                    autoComplete="tel"
                    autoFocus
                    dir="ltr"
                    className="h-11 border-white/10 bg-black/30 pr-10 text-left text-slate-100 placeholder:text-slate-600"
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  ارقام فارسی و عربی نیز پذیرفته می‌شوند (نمونه: ۰۹۱۲۹۳۶۷۷۹۶).
                </p>
              </div>

              {error && <ErrorBox errors={error} />}

              <Button
                type="submit"
                disabled={loading}
                className="h-11 w-full bg-gradient-to-l from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-600/30 hover:opacity-95"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    در حال ارسال کد...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    دریافت کد تأیید
                  </>
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4" noValidate>
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setError(null);
                  setNotice(null);
                  setDevCode(null);
                }}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 transition-colors hover:text-white"
              >
                <ArrowRight className="size-3.5" />
                ویرایش شماره {phone}
              </button>

              <div className="space-y-2">
                <Label htmlFor="auth-code" className="text-slate-300">
                  کد تأیید ۵ رقمی
                </Label>
                <Input
                  id="auth-code"
                  value={code}
                  onChange={(event) =>
                    setCode(normalizeOtpCode(event.target.value).slice(0, 5))
                  }
                  placeholder="- - - - -"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  dir="ltr"
                  className="h-12 border-white/10 bg-black/30 text-center font-mono text-2xl tracking-[0.5em] text-slate-100 placeholder:text-slate-700"
                />
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">
                    {resendIn > 0
                      ? `ارسال مجدد تا ${resendIn} ثانیه`
                      : "مهلت ارسال مجدد فراهم است"}
                  </span>
                  <button
                    type="button"
                    disabled={resendIn > 0 || loading}
                    onClick={() => void requestCode(normalizePhone(phone))}
                    className="font-semibold text-indigo-300 transition-colors hover:text-indigo-200 disabled:cursor-not-allowed disabled:text-slate-600"
                  >
                    ارسال مجدد کد
                  </button>
                </div>
              </div>

              {notice && (
                <p className="flex items-start gap-1.5 rounded-lg bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-200">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                  {notice}
                </p>
              )}

              {smsDelivered === false && (
                <p className="text-[11px] text-amber-300/90">
                  ارسال پیامک از درگاه تأیید نشد؛ در صورت امکان چند لحظه بعد دوباره
                  درخواست کنید.
                </p>
              )}

              {devCode && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center font-mono text-sm text-amber-200">
                  کد آزمایشی: {devCode}
                </p>
              )}

              {error && <ErrorBox errors={error} />}

              <Button
                type="submit"
                disabled={loading || code.length !== 5}
                className="h-11 w-full bg-gradient-to-l from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-600/30 hover:opacity-95"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    در حال تأیید...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" />
                    ورود به سامانه
                  </>
                )}
              </Button>
            </form>
          )}

          <p className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-slate-500">
            <ShieldCheck className="size-3" />
            احراز هویت امن با کد یک‌بارمصرف
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ errors }: { errors: string[] }) {
  return (
    <Alert variant="destructive" className={cn("border-rose-500/40 bg-rose-500/10")}>
      <AlertTitle className="text-rose-200">خطا در احراز هویت</AlertTitle>
      <AlertDescription className="text-rose-200/90">
        <ul className="list-inside list-disc">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
