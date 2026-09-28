"use client";

import { useEffect, useState } from "react";
import { Coins, Loader2, X } from "lucide-react";

import {
  type BackendPlanType,
  type PlanTier,
  type PricingMatrixResponse,
  formatPersianNumber,
} from "./types";

export interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlan?: PlanTier;
  /** JWT of the authenticated user, if any — sent as a Bearer token so the
   * server can activate the plan without asking for a phone number again. */
  accessToken?: string | null;
  /** Known phone number, if any (used only when there is no accessToken). */
  phone?: string | null;
  /** Called after the server has issued an invoice and we are about to
   * redirect to the Zibal payment page — lets a parent do bookkeeping. */
  onInvoiceIssued?: (planType: BackendPlanType) => void;
}

interface RealPlanCard {
  planType: BackendPlanType;
  label: string;
  description: string;
}

const REAL_PLAN_COPY: Record<BackendPlanType, RealPlanCard> = {
  SINGLE_DRAFT: {
    planType: "SINGLE_DRAFT",
    label: "خرید لایحه تکی",
    description: "دانلود متن کامل لایحه دفاعیه یا دادخواست تولیدشده، قابل ویرایش و پرینت.",
  },
  VIP_MONTHLY_PRO: {
    planType: "VIP_MONTHLY_PRO",
    label: "اشتراک ماهانه نامحدود VIP",
    description: "دسترسی نامحدود به تحلیل پرونده، پیش‌نویس لوایح و مشاوره هوشمند برای یک ماه.",
  },
};

// این سه گزینه هنوز به هیچ plan_type واقعی در سرور (get_calculated_pricing)
// وصل نیستند؛ به‌جای شبیه‌سازی یک خرید موفق قلابی، فقط «به‌زودی» نمایش داده
// می‌شوند تا کاربر گمراه نشود.
/** Top-level helper (outside the component) so the redirect isn't seen by
 * the React Compiler lint rule as an in-render mutation of a global. */
const PAYMENT_HOSTS = new Set(["gateway.zibal.ir"]);

/** Only ever leave the site for the real payment gateway. */
function redirectToPaymentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !PAYMENT_HOSTS.has(u.hostname)) return false;
    window.location.href = u.toString();
    return true;
  } catch {
    return false;
  }
}

const COMING_SOON_TOKEN_PACKS = [
  { id: "pack-100k", label: "بسته ۱۰۰٬۰۰۰ توکن", tokens: 100000 },
  { id: "pack-500k", label: "بسته ۵۰۰٬۰۰۰ توکن", tokens: 500000 },
  { id: "pack-2m", label: "بسته ۲٬۰۰۰٬۰۰۰ توکن", tokens: 2000000 },
];

export function SubscriptionModal({
  isOpen,
  onClose,
  currentPlan = "عادی",
  accessToken,
  phone,
  onInvoiceIssued,
}: SubscriptionModalProps) {
  const [pricing, setPricing] = useState<PricingMatrixResponse | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState(phone ?? "");
  const [pendingPlan, setPendingPlan] = useState<BackendPlanType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // الگوی رسمی React برای بازنشانی وضعیت هنگام تغییر یک prop: مستقیماً حین
  // رندر (نه داخل effect) تا از رندر اضافی/cascading جلوگیری شود.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setError(null);
      setNotice(null);
      setPricing(null);
      setPricingError(null);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    // قیمت‌ها همیشه از سرور خوانده می‌شوند، هرگز از عدد ثابت در کلاینت —
    // مبلغ نهایی ریالی هم از همین ماتریس سرور محاسبه می‌شود.
    fetch("/api/v1/apps/judge/payments/pricing-matrix")
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: PricingMatrixResponse) => setPricing(data))
      .catch(() => setPricingError("دریافت قیمت‌های لحظه‌ای از سرور ناموفق بود."));
  }, [isOpen]);

  if (!isOpen) return null;

  const needsPhone = !accessToken;

  const startCheckout = async (planType: BackendPlanType) => {
    setError(null);
    setNotice(null);

    if (needsPhone && !/^09\d{9}$/.test(phoneInput.trim())) {
      setError("برای فعال‌سازی، ابتدا وارد سامانه شوید یا یک شماره همراه معتبر ایرانی (09xxxxxxxxx) وارد کنید.");
      return;
    }

    setPendingPlan(planType);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const res = await fetch("/api/v1/apps/judge/payments/create-invoice", {
        method: "POST",
        headers,
        body: JSON.stringify({
          plan_type: planType,
          phone: needsPhone ? phoneInput.trim() : phone ?? undefined,
        }),
      });

      if (res.status === 503) {
        setError("درگاه پرداخت موقتاً در دسترس نیست. لطفاً بعداً تلاش کنید.");
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === "SUCCESS" && data.payment_url) {
        try {
          window.sessionStorage.setItem("roxira_judge_track_id", data.track_id);
        } catch {
          // sessionStorage در دسترس نبود؛ صفحه بازگشت از query string می‌خواند
        }
        setNotice("فاکتور صادر شد. انتقال به درگاه بانکی زیبال...");
        onInvoiceIssued?.(planType);
        if (!redirectToPaymentUrl(data.payment_url)) {
          setError("آدرس درگاه پرداخت معتبر نیست. لطفاً با پشتیبانی تماس بگیرید.");
        }
      } else {
        setError(data.message || "صدور فاکتور انجام نشد. لطفاً دوباره تلاش کنید.");
      }
    } catch {
      setError("خطا در ارتباط با سرور برای صدور فاکتور.");
    } finally {
      setPendingPlan(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="خرید اشتراک و شارژ توکن"
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      dir="rtl"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="glass-overlay flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl text-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Coins className="size-4 text-amber-300" />
            <h3 className="text-sm font-bold text-foreground">اشتراک و شارژ توکن</h3>
            <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              طرح فعلی: {currentPlan}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {needsPhone && (
            <div className="mb-4 rounded-2xl border border-amber-400/40 bg-amber-500/[0.06] p-4">
              <label htmlFor="checkout-phone" className="mb-1.5 block text-xs font-semibold text-foreground">
                شماره همراه برای صدور فاکتور
              </label>
              <input
                id="checkout-phone"
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
                placeholder="09xxxxxxxxx"
                dir="ltr"
                inputMode="numeric"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                وارد نبوده‌اید؛ برای فعال‌سازی بدون ورود، یک شماره همراه ایرانی معتبر لازم است.
              </p>
            </div>
          )}

          {pricingError && (
            <p className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-[11px] text-destructive">
              {pricingError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(Object.keys(REAL_PLAN_COPY) as BackendPlanType[]).map((planType) => {
              const copy = REAL_PLAN_COPY[planType];
              const server = pricing?.plans?.[planType];
              const highlight = planType === "VIP_MONTHLY_PRO";
              return (
                <article
                  key={planType}
                  className={`relative flex flex-col rounded-2xl border p-5 ${
                    highlight
                      ? "border-amber-400/40 bg-amber-500/[0.06]"
                      : "border-border bg-muted/40"
                  }`}
                >
                  <h4 className="text-sm font-bold text-foreground">{copy.label}</h4>
                  <div className="mt-3 flex items-end gap-1.5">
                    {server ? (
                      <span className="text-2xl font-black text-foreground" dir="ltr">
                        {formatPersianNumber(server.price_toman)}
                      </span>
                    ) : (
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    )}
                    {server && <span className="pb-1 text-[11px] text-muted-foreground">تومان</span>}
                  </div>
                  <p className="mt-2 flex-1 text-[11px] leading-relaxed text-muted-foreground">
                    {copy.description}
                  </p>
                  <button
                    type="button"
                    disabled={!server || pendingPlan === planType}
                    onClick={() => startCheckout(planType)}
                    className={`mt-5 flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 ${
                      highlight
                        ? "bg-gradient-to-l from-amber-500 to-orange-500 text-slate-950"
                        : "border border-border bg-background text-foreground"
                    }`}
                  >
                    {pendingPlan === planType && <Loader2 className="size-3.5 animate-spin" />}
                    فعال‌سازی {copy.label}
                  </button>
                </article>
              );
            })}
          </div>

          <div className="mt-6">
            <h4 className="flex items-center gap-2 text-xs font-bold text-foreground">
              <Coins className="size-3.5 text-amber-300" />
              بسته‌های شارژ توکن
            </h4>
            <p className="mt-1 text-[11px] text-muted-foreground">
              بسته‌های شارژ توکن هنوز به درگاه پرداخت وصل نشده‌اند و به‌زودی فعال می‌شوند.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {COMING_SOON_TOKEN_PACKS.map((pack) => (
                <article
                  key={pack.id}
                  className="flex flex-col rounded-2xl border border-border bg-muted/30 p-4 opacity-70"
                >
                  <span className="text-xs font-semibold text-foreground">{pack.label}</span>
                  <span className="mt-2 text-[11px] text-muted-foreground">
                    {formatPersianNumber(pack.tokens)} توکن
                  </span>
                  <button
                    type="button"
                    disabled
                    className="mt-4 cursor-not-allowed rounded-xl border border-border bg-background px-3 py-2 text-[11px] font-semibold text-muted-foreground"
                  >
                    به‌زودی
                  </button>
                </article>
              ))}
            </div>
          </div>

          {notice && (
            <p className="mt-6 rounded-2xl border border-emerald-500/40 bg-emerald-950/20 p-4 text-[11px] leading-relaxed text-emerald-300">
              {notice}
            </p>
          )}
          {error && (
            <p className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-[11px] leading-relaxed text-destructive">
              {error}
            </p>
          )}

          <p className="mt-6 rounded-2xl border border-border bg-muted/30 p-4 text-[11px] leading-relaxed text-muted-foreground">
            مبلغ نهایی همیشه به تومان و بر اساس ماتریس قیمت لحظه‌ای سرور محاسبه می‌شود؛ هیچ مبلغی
            در مرورگر شما ساخته نمی‌شود.
          </p>
        </div>
      </div>
    </div>
  );
}

export default SubscriptionModal;
