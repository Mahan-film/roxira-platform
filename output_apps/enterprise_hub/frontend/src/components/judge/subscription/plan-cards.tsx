"use client";

import { useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import {
  LEVEL_COPY,
  PAID_LEVELS,
  RECOMMENDED_LEVEL,
  featureLines,
  monthlyEquivalent,
  periodLabel,
  planKey,
} from "@/lib/plan-catalog";
import type { PlanLimits } from "@/lib/plans-data";
import { SubscriptionModal } from "./subscription-modal";
import {
  type BackendPlanPrice,
  type BackendPlanType,
  type BillingPeriod,
  type PaidLevel,
  formatPersianNumber,
} from "./types";

const fa = (n: number) => formatPersianNumber(n);

export interface PlanCardsProps {
  /** `plans` map of GET /payments/pricing-matrix: the only source of prices. */
  plans: Record<string, BackendPlanPrice>;
  limits: PlanLimits;
  /** Deep link (?plan=): open the modal with this plan already selected. */
  initialPlan?: BackendPlanType;
}

/** The plan cards (free, basic, pro, premium + the gold team card) with a monthly/yearly toggle. */
export function PlanCards({ plans, limits, initialPlan }: PlanCardsProps) {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [modalPlan, setModalPlan] = useState<BackendPlanType | null>(initialPlan ?? null);
  const { accessToken, user } = useAuth();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <div role="group" aria-label="دورهٔ پرداخت" className="inline-flex rounded-full p-1" style={{ background: "var(--ap-surface-2)" }}>
          {(["monthly", "yearly"] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={`rounded-full px-4 py-2 text-sm ${period === p ? "ap-btn" : "ap-muted"}`}
              style={{ minHeight: 40 }}
            >
              {p === "monthly" ? "ماهانه" : "سالانه"}
            </button>
          ))}
        </div>
        <span className="rounded-full px-3 py-1 text-[13px]" style={{ background: "var(--ap-surface-2)", color: "var(--ap-ok)" }}>
          سالانه: ۲ ماه رایگان
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article className="ap-card flex flex-col space-y-3">
          <header>
            <h3 className="text-lg font-semibold">{LEVEL_COPY.free.title}</h3>
            <p className="ap-muted text-sm">{LEVEL_COPY.free.tagline}</p>
          </header>
          <p className="text-2xl font-semibold">
            {fa(0)} <span className="ap-muted text-sm font-normal">تومان</span>
          </p>
          <FeatureList lines={featureLines("free", limits, fa)} />
          <Link href="/chat" className="ap-btn ap-btn-ghost mt-auto w-full">
            شروع رایگان
          </Link>
        </article>

        {PAID_LEVELS.filter((level) => level !== "team").map((level) => (
          <PaidCard
            key={level}
            level={level}
            period={period}
            price={plans[planKey(level, period)]}
            limits={limits}
            recommended={level === RECOMMENDED_LEVEL}
            onBuy={() => setModalPlan(planKey(level, period))}
          />
        ))}
      </div>

      <TeamCard
        period={period}
        price={plans[planKey("team", period)]}
        limits={limits}
        onBuy={() => setModalPlan(planKey("team", period))}
      />

      <SubscriptionModal
        isOpen={modalPlan !== null}
        onClose={() => setModalPlan(null)}
        initialPlan={modalPlan ?? undefined}
        accessToken={accessToken}
        phone={user?.phone}
      />
    </div>
  );
}

function PaidCard({
  level,
  period,
  price,
  limits,
  recommended,
  onBuy,
}: {
  level: PaidLevel;
  period: BillingPeriod;
  price: BackendPlanPrice | undefined;
  limits: PlanLimits;
  recommended: boolean;
  onBuy: () => void;
}) {
  const copy = LEVEL_COPY[level];
  return (
    <article
      className="ap-card relative flex flex-col space-y-3"
      style={recommended ? { outline: "2px solid var(--ap-accent)", outlineOffset: -2 } : undefined}
    >
      {recommended && (
        <span className="ap-btn absolute -top-3 start-4 !min-h-0 px-3 py-0.5 text-[13px]" style={{ pointerEvents: "none" }}>
          پیشنهاد ما
        </span>
      )}
      <header>
        <h3 className="text-lg font-semibold">{copy.title}</h3>
        <p className="ap-muted text-sm">{copy.tagline}</p>
      </header>
      {price ? (
        <div>
          <p className="text-2xl font-semibold">
            {fa(price.price_toman)}{" "}
            <span className="ap-muted text-sm font-normal">تومان {periodLabel(period)}</span>
          </p>
          {period === "yearly" && (
            <p className="ap-muted text-[13px]">معادل {fa(monthlyEquivalent(price))} تومان در ماه</p>
          )}
        </div>
      ) : (
        <p className="ap-muted text-sm" role="status">قیمت اکنون در دسترس نیست.</p>
      )}
      <FeatureList lines={featureLines(level, limits, fa)} />
      <button
        type="button"
        className={recommended ? "ap-btn mt-auto w-full" : "ap-btn ap-btn-ghost mt-auto w-full"}
        disabled={!price}
        onClick={onBuy}
      >
        خرید اشتراک {copy.title}
      </button>
    </article>
  );
}

/** Gold, full-width card for the team / organisation plan (law firms and legal teams). */
function TeamCard({
  period,
  price,
  limits,
  onBuy,
}: {
  period: BillingPeriod;
  price: BackendPlanPrice | undefined;
  limits: PlanLimits;
  onBuy: () => void;
}) {
  const copy = LEVEL_COPY.team;
  return (
    <article
      aria-labelledby="team-plan-h"
      className="relative grid gap-5 rounded-2xl p-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:p-6"
      style={{
        border: "1px solid var(--gh-gold)",
        background: "linear-gradient(135deg, rgba(212,175,55,0.14), rgba(212,175,55,0.04))",
      }}
    >
      <div className="flex flex-col space-y-3">
        <header>
          <h3 id="team-plan-h" className="text-lg font-semibold" style={{ color: "var(--gh-gold)" }}>
            {copy.title} <span className="text-sm font-normal">(وکلا و تیم‌های حقوقی)</span>
          </h3>
          <p className="ap-muted text-sm">
            برای دفاتر وکالت و تیم‌های حقوقی: بررسی ساختاریافتهٔ قرارداد، بالاترین سقف پرسش و بارگذاری، و بهترین مدل‌های دنیا.
          </p>
        </header>
        {price ? (
          <div>
            <p className="text-2xl font-semibold">
              {fa(price.price_toman)}{" "}
              <span className="ap-muted text-sm font-normal">تومان {periodLabel(period)}</span>
            </p>
            {price.usd != null && (
              <p className="ap-muted text-[13px]">معادل {fa(price.usd)} دلار {periodLabel(period)}</p>
            )}
            {period === "yearly" && (
              <p className="ap-muted text-[13px]">معادل {fa(monthlyEquivalent(price))} تومان در ماه</p>
            )}
          </div>
        ) : (
          <p className="ap-muted text-sm" role="status">قیمت اکنون در دسترس نیست.</p>
        )}
        <button
          type="button"
          className="mt-auto w-full rounded-xl px-4 py-2.5 text-sm font-bold transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: "var(--gh-gold)", color: "var(--gh-on-gold)", minHeight: 44 }}
          disabled={!price}
          onClick={onBuy}
        >
          خرید اشتراک {copy.title}
        </button>
      </div>
      <FeatureList lines={featureLines("team", limits, fa)} />
    </article>
  );
}

function FeatureList({ lines }: { lines: string[] }) {
  return (
    <ul className="space-y-1.5 text-sm leading-6">
      {lines.map((line) => (
        <li key={line} className="flex gap-2">
          <span aria-hidden="true" style={{ color: "var(--ap-ok)" }}>✓</span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

export default PlanCards;
