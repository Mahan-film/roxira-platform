"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { SubscriptionModal } from "./subscription-modal";

export interface SubscriptionCtaProps {
  /** متن دکمه؛ پیش‌فرض یک برچسب عمومی خرید اشتراک است. */
  label?: string;
  className?: string;
}

/**
 * دکمهٔ خرید اشتراک برای صفحات سرور (مثل /services).
 *
 * خود صفحهٔ `/services` یک Server Component است و نمی‌تواند state مودال را
 * نگه دارد؛ این پوستهٔ کلاینتی فقط مودال واقعی اشتراک را باز می‌کند. مودال
 * خودش قیمت را از سرور می‌خواند و `create-invoice` را صدا می‌زند.
 */
export function SubscriptionCta({
  label = "خرید و فعال‌سازی اشتراک",
  className,
}: SubscriptionCtaProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { accessToken, user } = useAuth();

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className={className}>
        {label}
      </button>

      <SubscriptionModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        accessToken={accessToken}
        phone={user?.phone}
      />
    </>
  );
}

export default SubscriptionCta;
