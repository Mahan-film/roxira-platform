"use client";

import { useState } from "react";
import { Coins, Sparkles } from "lucide-react";

import { type PlanTier, type SubscriptionSelection, formatPersianNumber } from "./types";
import { SubscriptionModal } from "./subscription-modal";

const PLAN_STYLES: Record<PlanTier, string> = {
  "عادی": "border-slate-600/50 bg-slate-700/20 text-slate-300",
  "طلایی": "border-amber-400/40 bg-amber-400/10 text-amber-300",
  "حقوقی": "border-violet-400/40 bg-violet-400/10 text-violet-300",
};

export interface UserQuotaBadgeProps {
  remainingTokens?: number;
  plan?: PlanTier;
  onTopUp?: (tokens: number) => void;
}

export function UserQuotaBadge({
  remainingTokens = 0,
  plan = "عادی",
  onTopUp,
}: UserQuotaBadgeProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const handleSelect = (selection: SubscriptionSelection) => {
    if (selection.tokens && onTopUp) {
      onTopUp(selection.tokens);
    }
    setNote(
      selection.tokens
        ? `${formatPersianNumber(selection.tokens)} توکن به سبد شما افزوده شد.`
        : `طرح «${selection.label}» انتخاب شد.`,
    );
    window.setTimeout(() => setNote(null), 4000);
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className="hidden items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900/80 px-2.5 py-1.5 font-mono text-[11px] text-slate-300 sm:inline-flex"
        title="توکن‌های باقی‌مانده"
      >
        <Coins className="size-3.5 text-amber-300" />
        {formatPersianNumber(remainingTokens)}
        <span className="text-slate-500">توکن</span>
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
        className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
      >
        افزایش موجودی
      </button>

      {note && (
        <span className="hidden text-[10px] text-emerald-300 lg:inline">{note}</span>
      )}

      <SubscriptionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        currentPlan={plan}
        onSelect={handleSelect}
      />
    </div>
  );
}

export default UserQuotaBadge;
