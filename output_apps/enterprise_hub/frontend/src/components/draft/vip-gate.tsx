"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { SubscriptionModal } from "@/components/judge/subscription/subscription-modal";
import { formatPersianNumber, type PricingMatrixResponse } from "@/components/judge/subscription/types";
import type { PlanLevel } from "@/lib/plan-catalog";

const PRICING_URL = "/api/v1/apps/judge/payments/pricing-matrix";

function isVipTier(tier: string | undefined): boolean {
  return Boolean(tier && tier.toUpperCase().includes("VIP"));
}

/** Plan levels the server allows ruling / indictment drafts for; legacy VIP has no level. */
const ENTITLED_PLAN_LEVELS: readonly PlanLevel[] = ["pro", "premium"];

/** Basic users are tier "VIP" on the server but get a 403 for these drafts, so check the level. */
function isDraftEntitled(tier: string | undefined, planLevel: PlanLevel | undefined): boolean {
  if (!isVipTier(tier)) return false;
  if (!planLevel || planLevel === "free") return true;
  return ENTITLED_PLAN_LEVELS.includes(planLevel);
}

/**
 * Shows the lock card (real prices from the pricing API + login/upgrade CTA)
 * instead of the form for guests and users below the pro plan, so nobody types a
 * long case before hitting the paywall. The server still enforces pro/premium on submit.
 */
export function VipGate({ children, feature }: { children: ReactNode; feature: string }) {
  const { isAuthenticated, isLoading, user, accessToken, openLogin } = useAuth();
  const [pricing, setPricing] = useState<PricingMatrixResponse | null>(null);
  const [pricingError, setPricingError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // Stored tier can be stale right after a payment: let the user open the form explicitly.
  const [forceOpen, setForceOpen] = useState(false);

  const planLevel = user?.planLevel;
  const entitled = isAuthenticated && isDraftEntitled(user?.subscriptionTier, planLevel);
  const isBasicUser = isAuthenticated && planLevel === "basic";

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

  // Ruling/indictment drafts need the pro plan or higher: offer only those (monthly) here.
  const plans = (["SJ_PRO_MONTHLY", "SJ_PREMIUM_MONTHLY"] as const)
    .map((key) => pricing?.plans?.[key])
    .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));

  return (
    <section className="ap-card no-print mb-12 text-center" aria-labelledby="vip-lock-title">
      <Lock className="mx-auto size-8" aria-hidden="true" />
      <h2 id="vip-lock-title" className="mt-3 text-xl font-semibold">
        {feature} به اشتراک حرفه‌ای یا بالاتر نیاز دارد
      </h2>
      <p className="ap-muted mx-auto mt-2 max-w-xl">
        {isBasicUser
          ? "اشتراک پایه برای این پیش‌نویس کافی نیست. برای دسترسی، به اشتراک حرفه‌ای (Pro) ارتقا دهید."
          : isAuthenticated
            ? "این پیش‌نویس برای کاربران VIP است. برای دسترسی، اشتراک حرفه‌ای یا بالاتر تهیه کنید."
            : "برای استفاده ابتدا وارد شوید و اشتراک حرفه‌ای تهیه کنید؛ پیش از آن چیزی لازم نیست تایپ کنید."}
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
        <Link href="/plans" className="ap-link underline">
          مقایسهٔ امکانات و قیمت‌ها
        </Link>
        <span className="ap-muted"> · </span>
        <button type="button" className="ap-link underline" onClick={() => setForceOpen(true)}>
          اشتراک فعال دارم؛ نمایش فرم
        </button>
      </p>
      <SubscriptionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        initialPlan="SJ_PRO_MONTHLY"
        accessToken={accessToken}
        phone={user?.phone}
      />
    </section>
  );
}

export default VipGate;
