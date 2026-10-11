"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { SubscriptionModal } from "@/components/judge/subscription/subscription-modal";
import { formatPersianNumber, type PricingMatrixResponse } from "@/components/judge/subscription/types";

const PRICING_URL = "/api/v1/apps/judge/payments/pricing-matrix";

function isVipTier(tier: string | undefined): boolean {
  return Boolean(tier && tier.toUpperCase().includes("VIP"));
}

/**
 * Shows the lock card (real prices from the pricing API + login/upgrade CTA)
 * instead of the form for guests and FREE users, so nobody types a long case
 * before hitting the paywall. The server still enforces VIP on submit.
 */
export function VipGate({ children, feature }: { children: ReactNode; feature: string }) {
  const { isAuthenticated, isLoading, user, accessToken, openLogin } = useAuth();
  const [pricing, setPricing] = useState<PricingMatrixResponse | null>(null);
  const [pricingError, setPricingError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // Stored tier can be stale right after a payment: let the user open the form explicitly.
  const [forceOpen, setForceOpen] = useState(false);

  const entitled = isAuthenticated && isVipTier(user?.subscriptionTier);

  useEffect(() => {
    if (entitled || isLoading) return;
    let cancelled = false;
    fetch(PRICING_URL, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: PricingMatrixResponse) => !cancelled && setPricing(data))
      .catch(() => !cancelled && setPricingError(true));
    return () => {
      cancelled = true;
    };
  }, [entitled, isLoading]);

  if (isLoading) return <p className="ap-muted py-8 text-center" role="status">در حال بررسی دسترسی…</p>;
  if (entitled || forceOpen) return <>{children}</>;

  const plans = Object.values(pricing?.plans ?? {});

  return (
    <section className="ap-card no-print mb-12 text-center" aria-labelledby="vip-lock-title">
      <Lock className="mx-auto size-8" aria-hidden="true" />
      <h2 id="vip-lock-title" className="mt-3 text-xl font-semibold">
        {feature} فقط برای کاربران VIP است
      </h2>
      <p className="ap-muted mx-auto mt-2 max-w-xl">
        {isAuthenticated
          ? "حساب شما اشتراک VIP ندارد. پیش از وارد کردن اطلاعات پرونده، اشتراک تهیه کنید."
          : "برای استفاده ابتدا وارد شوید و اشتراک VIP تهیه کنید؛ پیش از آن چیزی لازم نیست تایپ کنید."}
      </p>
      <ul className="mx-auto mt-4 max-w-md space-y-2 text-start">
        {plans.map((plan) => (
          <li key={plan.name} className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: "var(--ap-surface-2)" }}>
            <span>{plan.name}</span>
            <span className="font-semibold">{formatPersianNumber(plan.price_toman)} تومان</span>
          </li>
        ))}
        {!pricing && !pricingError && <li className="ap-muted text-center" role="status">در حال دریافت قیمت‌ها…</li>}
        {pricingError && <li className="ap-muted text-center">دریافت قیمت‌ها انجام نشد؛ از دکمه زیر قیمت را ببینید.</li>}
      </ul>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {!isAuthenticated && (
          <button
            type="button"
            className="ap-btn"
            onClick={() =>
              openLogin({
                serviceDomain: "GHAZI",
                title: "ورود به قاضی هوشمند",
                description: "کد تأیید به شمارهٔ همراه شما پیامک می‌شود.",
              })
            }
          >
            ورود با پیامک
          </button>
        )}
        <button type="button" className={isAuthenticated ? "ap-btn" : "ap-btn ap-btn-ghost"} onClick={() => setModalOpen(true)}>
          خرید اشتراک
        </button>
      </div>
      <p className="mt-4 text-[13px]">
        <button type="button" className="ap-link underline" onClick={() => setForceOpen(true)}>
          اشتراک فعال دارم؛ نمایش فرم
        </button>
      </p>
      <SubscriptionModal isOpen={modalOpen} onClose={() => setModalOpen(false)} accessToken={accessToken} phone={user?.phone} />
    </section>
  );
}

export default VipGate;
