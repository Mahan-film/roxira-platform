"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { track } from "@/lib/analytics/umami";
import { loadStoredSession, saveStoredSession } from "@/lib/api/auth-client";

/**
 * صفحه بازگشت از درگاه زیبال (callbackUrl فاکتور).
 *
 * زیبال کاربر را با query params `trackId` و `success` به این آدرس برمی‌گرداند.
 * این صفحه فقط trackId را می‌خواند و /payments/verify را صدا می‌زند — مبلغ و
 * وضعیت نهایی همیشه سمت سرور (با استعلام واقعی از زیبال) تعیین می‌شود، نه اینجا؛
 * `success=1` در آدرس هرگز به‌تنهایی اعتبار ندارد.
 *
 * سرور ممکن است "PENDING_RETRY" برگرداند (پاسخ قطعی از زیبال نرسیده، مثلاً
 * خطای گذرای شبکه) — این یعنی سفارش هنوز pending است و می‌شود دوباره تلاش کرد؛
 * با "تایید نشدن قطعی پرداخت" اشتباه گرفته نشود.
 */
type VerifyState = "checking" | "paid" | "failed" | "unavailable" | "pending_retry";

interface PaidDetails {
  planName: string | null;
  expiresAt: string | null;
  activationPending: boolean;
}

const GENERIC_FAILURE = "پرداخت شما تأیید نشد. در صورت کسر وجه، مبلغ ظرف ۷۲ ساعت به حساب شما بازمی‌گردد.";

/** Never show raw English / gateway text: anything without Persian letters falls back. */
function persianOr(message: unknown, fallback: string): string {
  return typeof message === "string" && /[؀-ۿ]/.test(message) ? message : fallback;
}

function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("fa-IR", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

/** Make the chat UI see the new plan without a re-login (session is in localStorage). */
function refreshStoredPlan(planLevel: unknown): void {
  try {
    if (planLevel !== "basic" && planLevel !== "pro" && planLevel !== "premium") return;
    const session = loadStoredSession();
    if (!session) return;
    saveStoredSession({
      ...session,
      user: { ...session.user, planLevel, subscriptionTier: "VIP" },
    } as typeof session); // also fires "roxira-auth-changed"
  } catch {
    // best effort only
  }
}

function PaymentCallbackContent() {
  const params = useSearchParams();
  const [state, setState] = useState<VerifyState>("checking");
  const [message, setMessage] = useState("در حال بررسی نتیجه پرداخت...");
  const [paid, setPaid] = useState<PaidDetails | null>(null);
  const trackIdRef = useRef<string | null>(null);

  const runVerify = useCallback(async (trackId: string) => {
    setState("checking");
    setMessage("در حال بررسی نتیجه پرداخت...");
    try {
      const res = await fetch("/api/v1/apps/judge/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_id: trackId }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 503 && data.status === "PENDING_RETRY") {
        setState("pending_retry");
        setMessage(
          persianOr(data.message, "امکان تایید قطعی نتیجهٔ پرداخت در حال حاضر وجود ندارد. لطفاً دوباره تلاش کنید.")
        );
        return;
      }
      if (res.status === 503) {
        setState("unavailable");
        setMessage("درگاه پرداخت موقتاً در دسترس نیست.");
        return;
      }

      if (res.ok && data.status === "PAID") {
        track("payment_success");
        setState("paid");
        setMessage(persianOr(data.message, "پرداخت با موفقیت تایید شد."));
        setPaid({
          planName: typeof data.plan_name === "string" ? data.plan_name : null,
          expiresAt: typeof data.expires_at === "string" ? data.expires_at : null,
          activationPending: data.activation_pending === true,
        });
        refreshStoredPlan(data.plan_level);
        try {
          window.sessionStorage.removeItem("roxira_judge_track_id");
        } catch {
          // ignore
        }
      } else {
        setState("failed");
        setMessage(persianOr(data.message, GENERIC_FAILURE));
      }
    } catch {
      // خطای شبکه در خودِ فرانت‌اند (نه پاسخ سرور) — قابل تلاش دوباره است.
      setState("pending_retry");
      setMessage("خطا در ارتباط با سرور برای تایید پرداخت. لطفاً دوباره تلاش کنید.");
    }
  }, []);

  useEffect(() => {
    (async () => {
      const trackId =
        params.get("trackId") ||
        params.get("track_id") ||
        (typeof window !== "undefined" ? window.sessionStorage.getItem("roxira_judge_track_id") : null);

      const zibalSuccess = params.get("success");

      if (!trackId) {
        setState("failed");
        setMessage("شناسه پیگیری تراکنش یافت نشد.");
        return;
      }
      trackIdRef.current = trackId;

      if (zibalSuccess === "0") {
        setState("failed");
        setMessage("پرداخت توسط شما لغو شد یا ناموفق بود. در صورت کسر وجه، مبلغ ظرف ۷۲ ساعت به حساب شما بازمی‌گردد.");
        return;
      }

      await runVerify(trackId);
    })();
  }, [params, runVerify]);

  const color =
    state === "paid"
      ? "text-emerald-400"
      : state === "checking"
        ? "text-slate-400"
        : state === "pending_retry"
          ? "text-amber-400"
          : "text-rose-300";

  const title =
    state === "paid" ? "پرداخت موفق" : state === "checking" ? "در حال بررسی پرداخت" : "نتیجه پرداخت";
  const expiry = formatExpiry(paid?.expiresAt ?? null);
  const cta =
    "inline-block px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60";
  const secondary =
    "inline-block px-5 py-2.5 border border-white/15 text-slate-200 hover:bg-white/5 text-sm font-semibold rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30";

  return (
    <div className="dark min-h-screen bg-[#070B14] flex items-center justify-center p-4" dir="rtl">
      <div className="bg-[#0B111F] border border-white/10 rounded-3xl p-8 max-w-md w-full text-center space-y-4 shadow-2xl shadow-black/50">
        <h1 className="text-lg font-bold text-white">{title}</h1>
        <p className={`text-sm leading-relaxed ${color}`} role="status">{message}</p>

        {state === "paid" && paid && (
          <dl className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-slate-200 space-y-2 text-right">
            {paid.planName && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">طرح فعال</dt>
                <dd className="font-semibold">{paid.planName}</dd>
              </div>
            )}
            {expiry && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">تاریخ انقضا</dt>
                <dd className="font-semibold">{expiry}</dd>
              </div>
            )}
          </dl>
        )}

        {state === "paid" && paid?.activationPending && (
          <p className="text-xs text-amber-300">
            پرداخت شما ثبت شد، اما فعال‌سازی طرح چند دقیقه زمان می‌برد. اگر فعال نشد با پشتیبانی تماس بگیرید.
          </p>
        )}

        {state === "pending_retry" && (
          <button type="button" onClick={() => trackIdRef.current && runVerify(trackIdRef.current)} className={cta}>
            تلاش دوباره برای تایید پرداخت
          </button>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {state === "paid" && (
            <a href="/chat" className={cta}>
              بازگشت به گفتگو با قاضی هوشمند
            </a>
          )}
          {(state === "failed" || state === "unavailable") && (
            <>
              <a href="/plans" className={cta}>
                تلاش دوباره
              </a>
              <a href="/contact" className={secondary}>
                تماس با پشتیبانی
              </a>
            </>
          )}
          {state !== "paid" && state !== "failed" && state !== "unavailable" && (
            <a href="/chat" className={secondary}>
              بازگشت به میز کار
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PaymentCallbackPage() {
  return (
    <Suspense fallback={null}>
      <PaymentCallbackContent />
    </Suspense>
  );
}
