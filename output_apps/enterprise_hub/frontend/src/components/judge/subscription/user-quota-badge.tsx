"use client";

import { useState } from "react";
import { Coins, Sparkles } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { type PlanTier, formatPersianNumber } from "./types";
import { SubscriptionModal } from "./subscription-modal";

const PLAN_STYLES: Record<PlanTier, string> = {
  "عادی": "border-border bg-muted text-foreground",
  "طلایی": "border-amber-400/40 bg-amber-400/10 text-amber-300",
  "حقوقی": "border-violet-400/40 bg-violet-400/10 text-violet-300",
};

export interface UserQuotaBadgeProps {
  remainingTokens?: number;
  plan?: PlanTier;
}

export function UserQuotaBadge({
  remainingTokens = 0,
  plan = "عادی",
}: UserQuotaBadgeProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const { accessToken, user } = useAuth();

  return (
    <div className="flex items-center gap-2">
      <span
        className="hidden items-center gap-1.5 rounded-xl border border-border bg-muted px-2.5 py-1.5 font-mono text-[11px] text-foreground sm:inline-flex"
        title="توکن‌های باقی‌مانده"
      >
        <Coins className="size-3.5 text-amber-300" />
        {formatPersianNumber(remainingTokens)}
        <span className="text-muted-foreground">توکن</span>
      </span>

      <span
        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold ${PLAN_STYLES[plan]}`}
        title="طرح اشتراک فعال"
      >
        <Sparkles className="size-3" />
        {plan}
      </span>

      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        افزایش موجودی
      </button>

      <SubscriptionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        currentPlan={plan}
        accessToken={accessToken}
        phone={user?.phone}
      />
    </div>
  );
}

export default UserQuotaBadge;
