"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  type AuthServiceDomain,
  type AuthSession,
  type UserRole,
  sendOtp as sendEnterpriseOtp,
  verifyOtp as verifyEnterpriseOtp,
} from "@/lib/api/auth-client";
import { ApiClientError } from "@/lib/api/http-client";
import {
  JudgeAuthError,
  isValidIranianMobile,
  normalizeOtpCode,
  normalizePhone,
  sendJudgeOtp,
  verifyJudgeOtp,
} from "@/lib/api/judge-auth-client";
import { track } from "@/lib/analytics/umami";
import { cn } from "@/lib/utils";

/** Minimum wait before the user may request another code. */
const RESEND_COOLDOWN_SECONDS = 60;
/** Dev-only OTP echo box; never rendered in production builds. */
const NETWORK_ERROR_COPY = "اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید یا چند لحظه بعد دوباره تلاش کنید.";

/**
 * Retry a NestJS auth call on network failures only (Safari "Load failed",
 * dropped mobile/VPN connections), like the Smart Judge client does. HTTP
 * errors (ApiClientError) are real answers from the server and are not retried.
 */
async function withNetworkRetry<T>(call: () => Promise<T>, onRetry: () => void): Promise<T> {
  const attempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (err) {
      if (err instanceof ApiClientError || attempt >= attempts) throw err;
      onRetry();
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
}
const OTP_LENGTH = 5;
/** Give up waiting for the SMS auto-read after this long. */
const WEBOTP_TIMEOUT_MS = 120_000;

/**
 * Pull the 5-digit code out of whatever was typed, autofilled or pasted
 * (a whole SMS included). Persian/Arabic digits are normalised, spaces ignored.
 */
function extractOtp(raw: string): string {
  const spaced = Array.from(raw)
    .map((ch) => normalizeOtpCode(ch) || " ")
    .join("");
  const run = spaced.match(/(?<!\d)\d{5}(?!\d)/);
  if (run) return run[0];
  return normalizeOtpCode(raw).slice(0, OTP_LENGTH);
}
const SHOW_DEV_CODE = process.env.NODE_ENV !== "production";

function toUserRole(role: string | null | undefined): UserRole {
  const upper = typeof role === "string" ? role.toUpperCase() : "";
  return upper === "ADMIN" || upper === "LAWYER" ? upper : "USER";
}

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
 * نکتهٔ حیاتی مسیرها:
 *   • دامنهٔ قاضی هوشمند (`GHAZI`) → از `judge-auth-client` به مسیر قطعی
 *     `/api/v1/apps/judge/auth/send-otp` (موتور پایتون).
 *   • پورتال سازمانی روکسیرا (`ROXIRA`) → از `auth-client` به مسیر NestJS
 *     `/api/backend/auth/...`؛ در این حالت فیلد اختیاری «نام سازمان» نیز
 *     به‌عنوان `organizationName` در verify-otp ارسال می‌شود.
 * شماره همراه پیش از ارسال نرمال‌سازی می‌گردد و پس از پاسخ موفق، مرحلهٔ
 * رابط به‌صورت خودکار به ورود کد منتقل می‌شود.
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
  const [retrying, setRetrying] = useState(false);
  const [networkFailed, setNetworkFailed] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  /** Last code already sent for verification: blocks double auto-submit. */
  const submittedCodeRef = useRef<string | null>(null);

  /** ورود از پورتال سازمانی روکسیرا (نه قاضی هوشمند) — مسیر NestJS فعال می‌شود. */
  const isEnterprise = serviceDomain === "ROXIRA";
  // Ghazi brand: gold primary with dark text (tokens in globals.css .ghazi-theme).
  // The Roxira enterprise login keeps its own blue.
  const isGhazi = !isEnterprise;
  const primaryBtn = isGhazi
    ? "bg-[var(--gh-gold)] font-bold text-[var(--gh-on-gold)] hover:bg-[var(--gh-gold-strong)] disabled:opacity-60"
    : "bg-[#0071e3] text-white hover:bg-[#0077ed]";
  const primaryIcon = isGhazi ? "bg-[var(--gh-gold)] text-[var(--gh-on-gold)]" : "bg-[#0071e3] text-white";

  useEffect(() => {
    if (!open) return;
    setStep("phone");
    setCode("");
    setError(null);
    setNotice(null);
    setDevCode(null);
    setResendIn(0);
    setSmsDelivered(null);
    setRetrying(false);
    setNetworkFailed(false);
    setOrganizationName("");
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

  const requestCode = useCallback(
    async (targetPhone: string) => {
      setLoading(true);
      setError(null);
      setNotice(null);
      setDevCode(null);
      setNetworkFailed(false);
      setRetrying(false);
      try {
        if (isEnterprise) {
          // پورتال سازمانی: مسیر NestJS (`/api/backend/auth/send-otp`)
          const response = await withNetworkRetry(() => sendEnterpriseOtp({
            phone: targetPhone,
            serviceDomain: "ROXIRA",
          }), () => setRetrying(true));
          setPhone(targetPhone);
          setStep("code");
          setCode("");
          setResendIn(RESEND_COOLDOWN_SECONDS);
          setSmsDelivered(response.smsDelivered);
          setDevCode(null);
          const validMinutes = Math.max(
            1,
            Math.round((response.expiresIn || 120) / 60),
          );
          setNotice(
            response.smsDelivered
              ? `کد تأیید ارسال شد. تا ${validMinutes.toLocaleString("fa-IR")} دقیقه اعتبار دارد. برای ارسال مجدد ۶۰ ثانیه صبر کنید.`
              : "کد تأیید صادر شد؛ در صورت عدم دریافت پیامک، چند لحظه بعد دوباره درخواست کنید.",
          );
          return;
        }

        const response = await sendJudgeOtp(targetPhone, {
          onRetry: () => setRetrying(true),
        });

        // پاسخ موفق → انتقال قطعی رابط به حالت ورود کد تأیید
        setPhone(targetPhone);
        setStep("code");
        setCode("");
        setResendIn(
          response.alreadySent && response.retryAfter
            ? Math.min(response.retryAfter, RESEND_COOLDOWN_SECONDS)
            : RESEND_COOLDOWN_SECONDS,
        );
        setSmsDelivered(response.deliveryConfirmed);
        setDevCode(SHOW_DEV_CODE ? response.devCode : null);
        const validMinutes = Math.max(
          1,
          Math.round((response.expiresIn || 180) / 60),
        );
        setNotice(
          response.alreadySent
            ? "کد تأیید پیش‌تر ارسال شده است؛ کد پیامک‌شده را وارد کنید."
            : response.deliveryConfirmed
              ? `کد تأیید ارسال شد. تا ${validMinutes.toLocaleString("fa-IR")} دقیقه اعتبار دارد. برای ارسال مجدد ۶۰ ثانیه صبر کنید.`
              : "کد تأیید صادر شد؛ در صورت عدم دریافت پیامک، چند لحظه بعد دوباره درخواست کنید.",
        );
      } catch (err) {
        if (err instanceof JudgeAuthError || err instanceof ApiClientError) {
          setError(err.details);
          setNetworkFailed(err.statusCode === 0);
        } else {
          setError([NETWORK_ERROR_COPY]);
          setNetworkFailed(true);
        }
      } finally {
        setLoading(false);
        setRetrying(false);
      }
    },
    [isEnterprise],
  );

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

  const submitCode = useCallback(
    async (cleanCode: string) => {
      submittedCodeRef.current = cleanCode;
      setLoading(true);
      setError(null);
      setNetworkFailed(false);
      setRetrying(false);
      try {
        if (isEnterprise) {
          const trimmedOrganization = organizationName.trim();
          const session = await withNetworkRetry(() => verifyEnterpriseOtp({
            phone,
            code: cleanCode,
            serviceDomain: "ROXIRA",
            organizationName: trimmedOrganization || undefined,
          }), () => setRetrying(true));
          onAuthenticated(session);
          onClose();
          return;
        }

        const session = await verifyJudgeOtp(phone, cleanCode, {
          onRetry: () => setRetrying(true),
        });
        // OTP verification is shared by sign-up and sign-in; the API does not flag new users yet.
        track("signup_completed");
        onAuthenticated({
          tokenType: session.tokenType,
          accessToken: session.accessToken,
          expiresIn: session.expiresIn,
          user: {
            id: session.user.id,
            phone: session.user.phone,
            displayName: session.user.displayName,
            email: session.user.email,
            role: toUserRole(session.user.role),
            subscriptionTier: session.user.subscriptionTier,
            planLevel: session.user.planLevel,
            serviceDomain: serviceDomain ?? "GHAZI",
            createdAt: new Date().toISOString(),
          },
        });
        onClose();
      } catch (err) {
        let offline = true;
        if (err instanceof JudgeAuthError || err instanceof ApiClientError) {
          setError(err.details);
          offline = err.statusCode === 0;
        } else {
          // fetch() rejects only on network failure: the code was not checked.
          setError([NETWORK_ERROR_COPY]);
        }
        setNetworkFailed(offline);
        if (!offline) {
          // the server rejected the code: clear it so the user can enter a new one
          setCode("");
          submittedCodeRef.current = null;
        }
      } finally {
        setLoading(false);
        setRetrying(false);
      }
    },
    [
      isEnterprise,
      onAuthenticated,
      onClose,
      organizationName,
      phone,
      serviceDomain,
    ],
  );

  const handleVerify = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const cleanCode = extractOtp(code);
      if (cleanCode.length < 4) {
        setError(["کد تأیید باید ۵ رقم باشد."]);
        return;
      }
      await submitCode(cleanCode);
    },
    [code, submitCode],
  );

  // Auto-submit once the field holds exactly 5 digits (typed, pasted, autofilled or WebOTP).
  useEffect(() => {
    if (!open || step !== "code" || loading) return;
    if (code.length < OTP_LENGTH) submittedCodeRef.current = null;
    if (code.length !== OTP_LENGTH || submittedCodeRef.current === code) return;
    void submitCode(code);
  }, [code, loading, open, step, submitCode]);

  // Android Chrome WebOTP: read the SMS (ending in "@domain #code") without typing.
  useEffect(() => {
    if (!open || step !== "code") return;
    if (typeof window === "undefined" || !("OTPCredential" in window)) return;
    const credentials = navigator.credentials;
    if (!credentials || typeof credentials.get !== "function") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), WEBOTP_TIMEOUT_MS);
    try {
      credentials
        .get({ otp: { transport: ["sms"] }, signal: controller.signal } as CredentialRequestOptions)
        .then((credential) => {
          const received = (credential as { code?: string } | null)?.code;
          if (received) setCode(extractOtp(received));
        })
        .catch(() => {
          // aborted, dismissed or unsupported: manual entry still works
        });
    } catch {
      // never let WebOTP break the login form
    }
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, step]);

  if (!open) return null;

  return (
    <div
      dir="rtl"
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4${isGhazi ? " ghazi-theme" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="بستن"
        onClick={handleClose}
        className="absolute inset-0 cursor-default bg-[#05080f]/80 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0a0f1a] text-slate-100 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className={`flex size-9 items-center justify-center rounded-xl ${primaryIcon}`}>
              <Lock className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-white">{title}</h2>
              <p className="text-xs text-slate-400">
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
                    placeholder="۰۹۱۲xxxxxxx"
                    inputMode="numeric"
                    autoComplete="tel"
                    autoFocus
                    dir="ltr"
                    className="h-11 border-white/10 bg-black/30 pr-10 text-left text-slate-100 placeholder:text-slate-600"
                  />
                </div>
                <p className="text-xs text-slate-400">
                  ارقام فارسی و عربی نیز پذیرفته می‌شوند (مثال: ۰۹۱۲xxxxxxx).
                </p>
              </div>

              {isEnterprise && (
                <div className="space-y-2">
                  <Label htmlFor="auth-organization" className="text-slate-300">
                    نام سازمان (برای ثبت سازمان جدید)
                  </Label>
                  <Input
                    id="auth-organization"
                    value={organizationName}
                    onChange={(event) => setOrganizationName(event.target.value)}
                    placeholder="مثلاً شرکت توسعه فناوری پارس"
                    maxLength={150}
                    className="h-11 border-white/10 bg-black/30 text-slate-100 placeholder:text-slate-600"
                  />
                  <p className="text-xs text-slate-400">
                    اختیاری؛ تنها اگر برای نخستین بار سازمانی ثبت می‌کنید آن را وارد کنید.
                  </p>
                </div>
              )}

              {error && <ErrorBox errors={error} />}
              {error && networkFailed && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading}
                  onClick={() => void requestCode(normalizePhone(phone))}
                  className="h-10 w-full border-white/10 bg-transparent text-slate-200"
                >
                  تلاش دوباره
                </Button>
              )}

              <Button
                type="submit"
                disabled={loading}
                className={`h-11 w-full ${primaryBtn}`}
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {retrying ? "اتصال ضعیف است؛ در حال تلاش دوباره…" : "در حال ارسال کد..."}
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
                className="inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-white"
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
                  name="otp"
                  type="text"
                  value={code}
                  onChange={(event) => setCode(extractOtp(event.target.value))}
                  onPaste={(event) => {
                    event.preventDefault();
                    setCode(extractOtp(event.clipboardData.getData("text")));
                  }}
                  maxLength={200}
                  placeholder="- - - - -"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  dir="ltr"
                  className="h-12 border-white/10 bg-black/30 text-center font-mono text-2xl tracking-[0.5em] text-slate-100 placeholder:text-slate-700"
                />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    {resendIn > 0
                      ? `ارسال مجدد تا ${resendIn} ثانیه`
                      : "مهلت ارسال مجدد فراهم است"}
                  </span>
                  <button
                    type="button"
                    disabled={resendIn > 0 || loading}
                    onClick={() => void requestCode(normalizePhone(phone))}
                    className="font-semibold text-sky-300 transition-colors hover:text-sky-200 disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    ارسال مجدد کد
                  </button>
                </div>
              </div>

              {notice && (
                <p className="flex items-start gap-1.5 rounded-lg bg-sky-400/10 px-3 py-2 text-xs text-sky-200">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                  {notice}
                </p>
              )}

              {smsDelivered === false && (
                <p className="text-xs text-amber-300/90">
                  ارسال پیامک از درگاه تأیید نشد؛ در صورت امکان چند لحظه بعد دوباره
                  درخواست کنید.
                </p>
              )}

              {SHOW_DEV_CODE && devCode && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center font-mono text-sm text-amber-200">
                  کد آزمایشی: {devCode}
                </p>
              )}

              {error && <ErrorBox errors={error} />}
              {error && networkFailed && (
                <Button
                  type="submit"
                  variant="outline"
                  disabled={loading || code.length !== 5}
                  className="h-10 w-full border-white/10 bg-transparent text-slate-200"
                >
                  تلاش دوباره
                </Button>
              )}

              <Button
                type="submit"
                disabled={loading || code.length !== 5}
                className={`h-11 w-full ${primaryBtn}`}
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {retrying ? "اتصال ضعیف است؛ در حال تلاش دوباره…" : "در حال تأیید..."}
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

          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
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
