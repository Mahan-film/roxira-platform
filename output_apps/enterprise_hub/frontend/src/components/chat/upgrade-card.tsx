"use client";

import Link from "next/link";

import { RECOMMENDED_LEVEL, planKey } from "@/lib/plan-catalog";

interface UpgradeCardProps {
  /** Guests are offered login first; logged-in free users only see the plans button. */
  showLogin: boolean;
  onLogin: () => void;
}

/** Friendly upsell shown under a chat notice when the free tier is limited or busy. */
export function UpgradeCard({ showLogin, onLogin }: UpgradeCardProps) {
  return (
    <div
      dir="rtl"
      className="mt-3 p-3 rounded-[14px] flex flex-wrap items-center gap-2"
      style={{ background: "var(--ap-surface-2)", color: "var(--ap-text)" }}
      role="note"
    >
      <p className="text-sm grow">با اشتراک ویژه بدون محدودیت روزانه و با اولویت پاسخ بگیرید.</p>
      {showLogin && (
        <button type="button" className="ap-chip" onClick={onLogin}>
          ورود به حساب
        </button>
      )}
      <Link href={`/plans?plan=${planKey(RECOMMENDED_LEVEL, "monthly")}`} className="ap-btn">
        مشاهده اشتراک‌ها
      </Link>
    </div>
  );
}
