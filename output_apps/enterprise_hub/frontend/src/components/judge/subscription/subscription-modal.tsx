"use client";

import { useEffect } from "react";
import { Coins, Sparkles, X } from "lucide-react";

import {
  type PlanTier,
  type SubscriptionSelection,
  formatPersianNumber,
  formatToman,
  tomanRate,
} from "./types";

export interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlan?: PlanTier;
  onSelect?: (selection: SubscriptionSelection) => void;
}

interface PlanOption {
  id: string;
  label: string;
  usd: number;
  period: string;
  tokensIncluded: number;
  perks: string[];
  highlight?: boolean;
  note?: string;
}

const PLANS: PlanOption[] = [
  {
    id: "monthly",
    label: "اشتراک ماهانه",
    usd: 9,
    period: "ماهانه",
    tokensIncluded: 120000,
    perks: [
      "پاسخ‌های نامحدود متنی",
      "تحلیل پرونده و پیش‌نویس لایحه",
      "سهمیه ۱۲۰٬۰۰۰ توکن در ماه",
      "پشتیبانی ایمیلی",
    ],
  },
  {
    id: "annual",
    label: "اشتراک سالانه",
    usd: 90,
    period: "سالانه",
    tokensIncluded: 1800000,
    perks: [
      "همه امکانات اشتراک ماهانه",
      "سهمیه ۱٬۸۰۰٬۰۰۰ توکن در سال",
      "دسترسی به موتور تحلیل عمیق (tier3)",
      "پشتیبانی اولویت‌دار",
    ],
    highlight: true,
    note: "معادل ۲ ماه هدیه",
  },
];

const TOKEN_PACKS: { id: string; label: string; usd: number; tokens: number }[] = [
  { id: "pack-100k", label: "بسته ۱۰۰٬۰۰۰ توکن", usd: 5, tokens: 100000 },
  { id: "pack-500k", label: "بسته ۵۰۰٬۰۰۰ توکن", usd: 20, tokens: 500000 },
  { id: "pack-2m", label: "بسته ۲٬۰۰۰٬۰۰۰ توکن", usd: 60, tokens: 2000000 },
];

export function SubscriptionModal({
  isOpen,
  onClose,
  currentPlan = "عادی",
  onSelect,
}: SubscriptionModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const rate = tomanRate();

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
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 text-slate-100 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Coins className="size-4 text-amber-300" />
            <h3 className="text-sm font-bold text-white">اشتراک و شارژ توکن</h3>
            <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400">
              طرح فعلی: {currentPlan}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="flex size-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PLANS.map((plan) => (
              <article
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border p-5 ${
                  plan.highlight
                    ? "border-amber-400/40 bg-amber-500/[0.06]"
                    : "border-slate-800 bg-slate-900/50"
                }`}
              >
                {plan.note && (
                  <span className="absolute -top-2.5 right-5 rounded-full bg-gradient-to-l from-amber-500 to-orange-500 px-3 py-0.5 text-[10px] font-bold text-slate-950">
                    {plan.note}
                  </span>
                )}
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-white">{plan.label}</h4>
                  <span className="font-mono text-[10px] text-slate-500">{plan.period}</span>
                </div>
                <div className="mt-3 flex items-end gap-1.5">
                  <span className="text-2xl font-black text-white" dir="ltr">
                    ${plan.usd}
                  </span>
                  <span className="pb-1 text-[11px] text-slate-500">/ {plan.period}</span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-emerald-300">
                  ≈ {formatToman(plan.usd)}
                </p>
                <ul className="mt-4 flex-1 space-y-2 text-[11px] leading-relaxed text-slate-300">
                  {plan.perks.map((perk) => (
                    <li key={perk} className="flex items-start gap-2">
                      <Sparkles className="mt-0.5 size-3 shrink-0 text-amber-300" />
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() =>
                    onSelect?.({
                      kind: plan.id === "annual" ? "annual" : "monthly",
                      id: plan.id,
                      label: plan.label,
                      usd: plan.usd,
                      tokens: plan.tokensIncluded,
                    })
                  }
                  className={`mt-5 rounded-xl px-4 py-2.5 text-xs font-bold transition-transform hover:-translate-y-0.5 ${
                    plan.highlight
                      ? "bg-gradient-to-l from-amber-500 to-orange-500 text-slate-950"
                      : "border border-white/15 bg-white/5 text-slate-100"
                  }`}
                >
                  فعال‌سازی {plan.label}
                </button>
              </article>
            ))}
          </div>

          <div className="mt-6">
            <h4 className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <Coins className="size-3.5 text-amber-300" />
              بسته‌های شارژ توکن
            </h4>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {TOKEN_PACKS.map((pack) => (
                <article
                  key={pack.id}
                  className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/50 p-4"
                >
                  <span className="text-xs font-semibold text-slate-200">{pack.label}</span>
                  <span className="mt-2 text-lg font-black text-white" dir="ltr">
                    ${pack.usd}
                  </span>
                  <span className="mt-1 font-mono text-[11px] text-emerald-300">
                    ≈ {formatToman(pack.usd)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onSelect?.({
                        kind: "tokens",
                        id: pack.id,
                        label: pack.label,
                        usd: pack.usd,
                        tokens: pack.tokens,
                      })
                    }
                    className="mt-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
                  >
                    افزودن {formatPersianNumber(pack.tokens)} توکن
                  </button>
                </article>
              ))}
            </div>
          </div>

          <p className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-[11px] leading-relaxed text-slate-400">
            قیمت‌ها بر پایه دلار تثبیت (Currency-Hedged) شده‌اند و مبلغ تومانی به‌صورت خودکار با
            نرخ روز <span className="font-mono text-slate-200" dir="ltr">1$ = {formatPersianNumber(rate)} تومان</span>{" "}
            محاسبه می‌شود. نرخ در زمان پرداخت نهایی اعمال می‌گردد.
          </p>
        </div>
      </div>
    </div>
  );
}

export default SubscriptionModal;
