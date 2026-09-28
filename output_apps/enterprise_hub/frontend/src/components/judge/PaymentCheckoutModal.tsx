"use client";

import React, { useEffect, useState } from "react";

import {
  type PricingMatrixResponse,
  formatPersianNumber,
} from "./subscription/types";

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  phone: string;
}

export default function PaymentCheckoutModal({ isOpen, onClose, phone }: PaymentModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<"SINGLE_DRAFT" | "VIP_MONTHLY_PRO">("SINGLE_DRAFT");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pricing, setPricing] = useState<PricingMatrixResponse | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // قیمت‌ها همیشه از سرور خوانده می‌شوند، هرگز عدد ثابت در کلاینت.
    fetch("/api/v1/apps/judge/payments/pricing-matrix")
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: PricingMatrixResponse) => setPricing(data))
      .catch(() => setPricing(null));
  }, [isOpen]);

  if (!isOpen) return null;

  const singleDraftPrice = pricing?.plans?.SINGLE_DRAFT?.price_toman;
  const vipMonthlyPrice = pricing?.plans?.VIP_MONTHLY_PRO?.price_toman;

  const handlePayment = async () => {
    setLoading(true);
    setNotice("");
    setError("");
    try {
      const res = await fetch("/api/v1/apps/judge/payments/create-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, plan_type: selectedPlan }),
      });

      if (res.status === 503) {
        setError("درگاه پرداخت موقتاً در دسترس نیست. لطفاً بعداً تلاش کنید.");
        return;
      }

      const data = await res.json();
      if (res.ok && data.status === "SUCCESS" && data.payment_url) {
        // شناسه پیگیری برای صفحه بازگشت (callback) که با /payments/verify تایید می‌کند
        try {
          window.sessionStorage.setItem("roxira_judge_track_id", data.track_id);
        } catch {
          // sessionStorage در دسترس نبود؛ صفحه بازگشت همچنان از query string می‌خواند
        }
        setNotice("فاکتور صادر شد. انتقال به درگاه بانکی زیبال...");
        window.location.href = data.payment_url;
      } else {
        setError(data.message || "صدور فاکتور انجام نشد. لطفاً دوباره تلاش کنید.");
      }
    } catch (e) {
      console.warn("Payment invoice error:", e);
      setError("خطا در ایجاد تراکنش پرداخت.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50" dir="rtl">
      <div className="bg-card border border-border rounded-3xl p-6 max-w-lg w-full space-y-6 shadow-2xl">
        <div className="flex justify-between items-center border-b border-border pb-3">
          <h2 className="font-bold text-lg text-card-foreground">💳 ارتقا و دریافت لایحه تخصصی</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded">✕</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div
            onClick={() => setSelectedPlan("SINGLE_DRAFT")}
            className={`cursor-pointer p-4 rounded-2xl border transition ${
              selectedPlan === "SINGLE_DRAFT"
                ? "bg-primary/10 border-primary text-foreground"
                : "bg-background border-border text-muted-foreground hover:border-ring/50"
            }`}
          >
            <div className="font-bold text-sm text-primary mb-1">خرید لایحه تکی</div>
            <div className="text-xl font-extrabold text-foreground mb-2">
              {singleDraftPrice != null ? formatPersianNumber(singleDraftPrice) : "..."}{" "}
              <span className="text-xs font-normal text-muted-foreground">تومان</span>
            </div>
            <p className="text-xs text-muted-foreground">دانلود متن کامل لایحه دفاعیه با قابلیت ویرایش و پرینت</p>
          </div>

          <div
            onClick={() => setSelectedPlan("VIP_MONTHLY_PRO")}
            className={`cursor-pointer p-4 rounded-2xl border transition ${
              selectedPlan === "VIP_MONTHLY_PRO"
                ? "bg-amber-950/40 border-amber-500 text-foreground"
                : "bg-background border-border text-muted-foreground hover:border-ring/50"
            }`}
          >
            <div className="font-bold text-sm text-amber-400 mb-1">اشتراک یک‌ماهه VIP</div>
            <div className="text-xl font-extrabold text-foreground mb-2">
              {vipMonthlyPrice != null ? formatPersianNumber(vipMonthlyPrice) : "..."}{" "}
              <span className="text-xs font-normal text-muted-foreground">تومان</span>
            </div>
            <p className="text-xs text-muted-foreground">دسترسی نامحدود به تحلیل پرونده‌ها، مدل‌های Claude و Gemini و مشاوره صوتی</p>
          </div>
        </div>

        <div className="bg-background p-4 rounded-xl border border-border text-xs text-muted-foreground space-y-1.5">
          <div className="flex justify-between"><span>شماره سفارش‌دهنده:</span><span className="font-mono text-foreground">{phone}</span></div>
          <div className="flex justify-between"><span>درگاه پرداخت:</span><span className="text-emerald-400 font-bold">زیبال / متصل به شبکه شتاب</span></div>
        </div>

        {notice && (
          <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-xs text-emerald-300">{notice}</div>
        )}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/40 rounded-xl text-xs text-destructive">{error}</div>
        )}

        <button
          onClick={handlePayment}
          disabled={loading || (selectedPlan === "SINGLE_DRAFT" ? singleDraftPrice == null : vipMonthlyPrice == null)}
          className="w-full py-3.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {loading ? "در حال اتصال به شاپرک..." : "پرداخت امن آنلاین 🔒"}
        </button>
      </div>
    </div>
  );
}
