"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * صفحه بازگشت از درگاه زیبال (callbackUrl فاکتور).
 *
 * زیبال کاربر را با query params `trackId` و `success` به این آدرس برمی‌گرداند.
 * این صفحه فقط trackId را می‌خواند و /payments/verify را صدا می‌زند — مبلغ و
 * وضعیت نهایی همیشه سمت سرور (با استعلام واقعی از زیبال) تعیین می‌شود، نه اینجا.
 *
 * سرور ممکن است "PENDING_RETRY" برگرداند (پاسخ قطعی از زیبال نرسیده، مثلاً
 * خطای گذرای شبکه) — این یعنی سفارش هنوز pending است و می‌شود دوباره تلاش کرد؛
 * با "تایید نشدن قطعی پرداخت" اشتباه گرفته نشود.
 */
type VerifyState = "checking" | "paid" | "failed" | "unavailable" | "pending_retry";

function PaymentCallbackContent() {
  const params = useSearchParams();
  const [state, setState] = useState<VerifyState>("checking");
  const [message, setMessage] = useState("در حال بررسی نتیجه پرداخت...");
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
          data.message || "امکان تایید قطعی نتیجهٔ پرداخت در حال حاضر وجود ندارد. لطفاً دوباره تلاش کنید."
        );
        return;
      }
      if (res.status === 503) {
        setState("unavailable");
        setMessage("درگاه پرداخت موقتاً در دسترس نیست.");
        return;
      }

      if (res.ok && data.status === "PAID") {
        setState("paid");
        setMessage(data.message || "پرداخت با موفقیت تایید شد.");
        try {
          window.sessionStorage.removeItem("roxira_judge_track_id");
        } catch {
          // ignore
        }
      } else {
        setState("failed");
        setMessage(data.message || "تایید پرداخت ناموفق بود.");
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
        setMessage("پرداخت توسط شما لغو شد یا ناموفق بود.");
        return;
      }

      await runVerify(trackId);
    })();
  }, [params, runVerify]);

  const color =
    state === "paid"
      ? "text-emerald-400"
      : state === "checking"
        ? "text-muted-foreground"
        : state === "pending_retry"
          ? "text-amber-400"
          : "text-destructive";

  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
      <div className="bg-card border border-border rounded-3xl p-8 max-w-md w-full text-center space-y-4">
        <h1 className="text-lg font-bold text-card-foreground">نتیجه پرداخت</h1>
        <p className={`text-sm ${color}`}>{message}</p>

        {state === "pending_retry" && (
          <button
            type="button"
            onClick={() => trackIdRef.current && runVerify(trackIdRef.current)}
            className="inline-block px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            تلاش دوباره برای تایید پرداخت
          </button>
        )}

        <a
          href="/judge"
          className="inline-block mt-4 px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          بازگشت به میز کار قاضی هوشمند
        </a>
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
