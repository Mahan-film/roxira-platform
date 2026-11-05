"use client";

import { cn } from "cn";

import { balanceMarker } from "@/lib/balance";
import { formatAmount, type MoneyUnit } from "@/lib/fa-format";
import { useMoneyUnit } from "@/lib/money-unit";

interface MoneyProps {
  value: number | string | null | undefined;
  unit?: MoneyUnit;
  suffix?: boolean;
  className?: string;
}

function isNegativeValue(value: MoneyProps["value"]): boolean {
  if (typeof value === "number") return value < 0;
  if (typeof value === "string") return value.trimStart().startsWith("-");
  return false;
}

/**
 * نمایش مبلغ ریالی با واحد انتخابی بیننده؛ منفی‌ها با پرانتز حسابداری
 * و رنگ کمکی — پرانتز نشانه اصلی است، رنگ فقط کمکی.
 */
export function Money({ value, unit, suffix = false, className }: MoneyProps) {
  const [viewerUnit] = useMoneyUnit();
  const negative = isNegativeValue(value);
  return (
    <span className={cn("num", negative && "money-negative", className)}>
      {negative && <span className="sr-only">منفی </span>}
      {formatAmount(value, unit ?? viewerUnit, { suffix, brackets: true })}
    </span>
  );
}

interface BalanceProps {
  value: number | string | bigint | null | undefined;
  unit?: MoneyUnit;
  className?: string;
}

/**
 * مانده حساب: قدر مطلق مبلغ + برچسب «بد»/«بس»/«بی‌حساب»؛ سمت بستانکار
 * خطا نیست، پس رنگ عادی می‌ماند و برچسب نشانه است.
 */
export function Balance({ value, unit, className }: BalanceProps) {
  const [viewerUnit] = useMoneyUnit();
  const marker = balanceMarker(value);
  if (!marker) {
    return <span className={cn("num", className)}>—</span>;
  }
  if (marker.side === "zero") {
    return (
      <span className={cn("num text-muted-foreground", className)}>
        <span className="text-xs">{marker.label}</span>
      </span>
    );
  }
  return (
    <span className={cn("num", className)}>
      {formatAmount(marker.abs, unit ?? viewerUnit, { suffix: false })}
      <span className="ms-1 text-xs text-muted-foreground">{marker.label}</span>
    </span>
  );
}
