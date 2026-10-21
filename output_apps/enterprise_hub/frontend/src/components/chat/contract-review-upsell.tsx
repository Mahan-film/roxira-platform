"use client";

import Link from "next/link";

interface ContractReviewUpsellProps {
  /** Guests are asked to log in first; logged-in users below premium only see the plans link. */
  showLogin: boolean;
  onLogin: () => void;
  onClose: () => void;
}

/** Shown when a user without the premium/team plan taps «بررسی قرارداد». */
export function ContractReviewUpsell({ showLogin, onLogin, onClose }: ContractReviewUpsellProps) {
  return (
    <div
      dir="rtl"
      className="flex flex-wrap items-center gap-2 rounded-[14px] p-3"
      style={{ background: "var(--ap-surface-2)", color: "var(--ap-text)", border: "1px solid var(--gh-gold, var(--ap-line))" }}
      role="note"
      aria-label="بررسی قرارداد"
    >
      <p className="grow text-sm leading-7">
        <strong>بررسی قرارداد</strong> ویژهٔ اشتراک ویژه و تیمی است: خلاصهٔ طرفین و تعهدات، بندهای پرریسک یا ناعادلانه با
        استناد به قوانین ایران، بندهای غایب، متن پیشنهادی اصلاح و امتیاز ریسک کلی، با بهترین مدل‌های دنیا.
      </p>
      {showLogin && (
        <button type="button" className="ap-chip" onClick={onLogin}>
          ورود به حساب
        </button>
      )}
      <Link href="/plans?plan=SJ_PREMIUM_MONTHLY" className="ap-btn">
        مشاهده اشتراک‌ها
      </Link>
      <button type="button" className="ap-chip" onClick={onClose} aria-label="بستن">
        بستن
      </button>
    </div>
  );
}
