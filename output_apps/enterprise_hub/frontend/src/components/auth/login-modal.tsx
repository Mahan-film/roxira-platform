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
  type UiLocale,
  type UserRole,
  isMfaChallenge,
  sendOtp as sendEnterpriseOtp,
  verifyOtp as verifyEnterpriseOtp,
} from "@/lib/api/auth-client";
import { ApiClientError } from "@/lib/api/http-client";
import { EmailAuthPanel } from "@/components/auth/email-auth-panel";
import { MfaCodeForm } from "@/components/auth/mfa-code-form";
import { PasswordAuthPanel } from "@/components/auth/password-auth-panel";
import {
  type JudgeAuthSession,
  JudgeAuthError,
  fetchAuthMethods,
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
const SMS_FAILED_COPY =
  "ارسال پیامک ممکن نشد. با رمز عبور وارد شوید یا چند دقیقه بعد دوباره تلاش کنید.";
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
const OTP_LENGTH = 6;
/** Give up waiting for the SMS auto-read after this long. */
const WEBOTP_TIMEOUT_MS = 120_000;

/**
 * Pull the 6-digit code out of whatever was typed, autofilled or pasted
 * (a whole SMS included). Persian/Arabic digits are normalised, spaces ignored.
 */
function extractOtp(raw: string): string {
  const spaced = Array.from(raw)
    .map((ch) => normalizeOtpCode(ch) || " ")
    .join("");
  const run = spaced.match(/(?<!\d)\d{6}(?!\d)/);
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
  /** "en" = roxira.net: English, email + password only (no Iranian SMS). */
  locale?: UiLocale;
  title?: string;
  description?: string;
  /** "signup" opens the password tab on the sign-up form. */
  authMode?: "login" | "signup";
}

/**
 * مودال ورود پیامکی سامانه قاضی هوشمند.
 *
 * جریان دو مرحله‌ای (PHONE → OTP):
 *   ۱) ورود شماره همراه ایران (09xxxxxxxxx) و ارسال کد ۶ رقمی
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
  authMode,
  locale = "fa",
  title = locale === "en" ? "Sign in" : "ورود به سامانه",
  description = locale === "en"
    ? "Sign in or create an account with your email and a password."
    : "شماره همراه خود را وارد کنید؛ کد تأیید ۶ رقمی پیامک می‌شود.",
}: LoginModalProps) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  /** Set when the account has an authenticator app and needs a code after the SMS code. */
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
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
  /** Sign-in method tab. The e-mail tab only exists when the server has SMTP configured. */
  const [tab, setTab] = useState<"phone" | "email" | "password">("phone");
  /** The SMS gateway refused the message: say so and offer password sign-in. */
  const [smsFailed, setSmsFailed] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
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

  function resetForm() {
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
    setTab(authMode === "signup" ? "password" : "phone");
    setSmsFailed(false);
  }

  // Reset the form each time the dialog opens (state adjusted during render,
  // not in an effect, so there is no extra render with stale fields).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      resetForm();
    }
  }

  useEffect(() => {
    if (!open || isEnterprise) return;
    let cancelled = false;
    void fetchAuthMethods().then((methods) => {
      if (!cancelled) setEmailEnabled(methods.email);
    });
    return () => {
      cancelled = true;
    };
  }, [open, isEnterprise]);

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
      setSmsFailed(false);
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
          setSmsDelivered(true);
          setDevCode(null);
          const validMinutes = Math.max(
            1,
            Math.round((response.expiresIn || 120) / 60),
          );
          setNotice(
            `کد تأیید ارسال شد. تا ${validMinutes.toLocaleString("fa-IR")} دقیقه اعتبار دارد. برای ارسال مجدد ۶۰ ثانیه صبر کنید.`,
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
              : null,
        );
      } catch (err) {
        if (err instanceof ApiClientError && err.code === "SMS_DELIVERY_FAILED") {
          // Real failure, not a soft hint: the code was not sent. Offer password sign-in.
          setError([SMS_FAILED_COPY]);
          setSmsFailed(true);
        } else if (err instanceof JudgeAuthError || err instanceof ApiClientError) {
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
      if (isEnterprise && authMode === "signup" && organizationName.trim().length < 2) {
        setError(["نام مجموعه را وارد کنید."]);
        return;
      }
      setPhone(normalized);
      await requestCode(normalized);
    },
    [authMode, isEnterprise, organizationName, phone, requestCode],
  );

  /** Map a Smart Judge session (OTP or e-mail login) to the app session and close. */
  const completeJudgeSession = useCallback(
    (session: JudgeAuthSession) => {
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
    },
    [onAuthenticated, onClose, serviceDomain],
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
          if (isMfaChallenge(session)) {
            setMfaChallenge(session.challenge);
            return;
          }
          onAuthenticated(session);
          onClose();
          return;
        }

        const session = await verifyJudgeOtp(phone, cleanCode, {
          onRetry: () => setRetrying(true),
        });
        // OTP verification is shared by sign-up and sign-in; the API does not flag new users yet.
        track("signup_completed");
        completeJudgeSession(session);
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
      completeJudgeSession,
      isEnterprise,
      onAuthenticated,
      onClose,
      organizationName,
      phone,
    ],
  );

  const handleVerify = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const cleanCode = extractOtp(code);
      if (cleanCode.length !== OTP_LENGTH) {
        setError(["کد تأیید باید ۶ رقم باشد."]);
        return;
      }
      await submitCode(cleanCode);
    },
    [code, submitCode],
  );

  // Auto-submit once the field holds exactly 6 digits (typed, pasted, autofilled or WebOTP).
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

  if (locale === "en") {
    // roxira.net: English, email/username + password only. Iranian SMS is not offered.
    return (
      <div
        dir="ltr"
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={handleClose}
          className="absolute inset-0 cursor-default bg-[#05080f]/80 backdrop-blur-sm"
        />
        <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0a0f1a] text-slate-100 shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-[#0071e3] text-white">
                <Lock className="size-4" />
              </span>
              <div>
                <h2 className="text-sm font-bold text-white">{title}</h2>
                <p className="text-xs text-slate-400">Roxira International</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close dialog"
              className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="px-5 py-5">
            <p className="mb-4 text-xs leading-relaxed text-slate-400">{description}</p>
            <PasswordAuthPanel
              locale="en"
              onSession={(session) => {
                onAuthenticated(session);
                onClose();
              }}
            />
            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="size-3" />
              Passwords are hashed; we never store them in plain text.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="ghazi-theme fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="بستن"
        onClick={handleClose}
        className="absolute inset-0 cursor-default bg-[var(--gh-bg)]/80 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--gh-border)] bg-[var(--gh-modal)] text-slate-100 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-[var(--gh-border)] px-5 py-4">
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
          {(isEnterprise || emailEnabled) && (
            <div role="tablist" className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1">
              {(isEnterprise ? (["phone", "password"] as const) : (["phone", "email"] as const)).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    "rounded-lg py-2 text-sm font-semibold transition-colors",
                    tab === id ? "bg-[var(--gh-gold)] text-[var(--gh-on-gold)]" : "text-slate-400 hover:text-white",
                  )}
                >
                  {id === "phone" ? (isEnterprise ? "پیامک" : "موبایل") : id === "password" ? "رمز عبور" : "ایمیل"}
                </button>
              ))}
            </div>
          )}

          {tab === "password" && isEnterprise ? (
            <PasswordAuthPanel
              key={authMode}
              locale="fa"
              initialMode={authMode}
              onSession={(session) => {
                onAuthenticated(session);
                onClose();
              }}
            />
          ) : tab === "email" && emailEnabled && !isEnterprise ? (
            <EmailAuthPanel onSession={completeJudgeSession} />
          ) : (
            <>
          <p className="mb-4 text-xs leading-relaxed text-slate-400">{description}</p>

          {mfaChallenge ? (
            <MfaCodeForm
              locale="fa"
              challenge={mfaChallenge}
              onSession={(session) => {
                onAuthenticated(session);
                onClose();
              }}
            />
          ) : step === "phone" ? (
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

              {isEnterprise && authMode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="auth-organization" className="text-slate-300">
                    نام مجموعه (سازمان، شرکت یا فروشگاه)
                  </Label>
                  <Input
                    id="auth-organization"
                    value={organizationName}
                    onChange={(event) => setOrganizationName(event.target.value)}
                    placeholder="مثلاً فروشگاه پارس"
                    maxLength={150}
                    className="h-11 border-white/10 bg-black/30 text-slate-100 placeholder:text-slate-600"
                  />
                  <p className="text-xs text-slate-400">
                    حساب شما با همین نام ساخته می‌شود. اگر کارمند هستید، از لینک دعوت ثبت‌نام کنید.
                  </p>
                </div>
              )}

              {error && <ErrorBox errors={error} />}
              {smsFailed && isEnterprise && (
                <Button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setError(null);
                    setSmsFailed(false);
                    setTab("password");
                  }}
                  className={`h-10 w-full ${primaryBtn}`}
                >
                  ورود با رمز عبور
                </Button>
              )}
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
                  کد تأیید ۶ رقمی
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
                  placeholder="- - - - - -"
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
                <div
                  role="alert"
                  className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
                >
                  <p>
                    ارسال پیامک تأیید نشد و ممکن است کدی دریافت نکنید.
                    {emailEnabled
                      ? " می‌توانید با ایمیل وارد شوید یا بعد از پایان مهلت، دوباره کد بگیرید."
                      : " بعد از پایان مهلت، دوباره کد بگیرید."}
                  </p>
                  {emailEnabled && !isEnterprise && (
                    <button
                      type="button"
                      onClick={() => setTab("email")}
                      className="font-semibold text-amber-100 underline"
                    >
                      ورود با ایمیل
                    </button>
                  )}
                </div>
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
                  disabled={loading || code.length !== OTP_LENGTH}
                  className="h-10 w-full border-white/10 bg-transparent text-slate-200"
                >
                  تلاش دوباره
                </Button>
              )}

              <Button
                type="submit"
                disabled={loading || code.length !== OTP_LENGTH}
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
            </>
          )}
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
