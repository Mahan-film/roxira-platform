"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Landmark,
  TriangleAlert,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatRial } from "@/lib/format";
import type { TrialBalanceResponse } from "@/types/accounting";

interface AccountingStatsProps {
  trialBalance: TrialBalanceResponse | null;
}

/**
 * کارت‌های بنتو (Bento) خلاصه وضعیت دفتر کل:
 * تعداد حساب‌ها، جمع بدهکار، جمع بستانکار و وضعیت تراز دفاتر.
 */
export function AccountingStats({ trialBalance }: AccountingStatsProps) {
  const accountCount = trialBalance?.rows.length ?? 0;
  const totalDebit = trialBalance?.totalDebit ?? 0;
  const totalCredit = trialBalance?.totalCredit ?? 0;
  const balanced = trialBalance?.balanced ?? false;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-indigo-500/15 via-transparent to-transparent ring-1 ring-indigo-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">تعداد حساب‌های دفتر کل</span>
            <span className="text-2xl font-bold">{accountCount.toLocaleString("fa-IR")}</span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-500">
            <Landmark className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-emerald-500/15 via-transparent to-transparent ring-1 ring-emerald-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">جمع بدهکار کل</span>
            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {formatRial(totalDebit)}
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
            <ArrowDownLeft className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-amber-500/15 via-transparent to-transparent ring-1 ring-amber-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">جمع بستانکار کل</span>
            <span className="text-lg font-bold text-amber-600 dark:text-amber-400">
              {formatRial(totalCredit)}
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
            <ArrowUpRight className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card
        className={
          balanced
            ? "relative overflow-hidden border-0 bg-gradient-to-br from-emerald-500/15 via-transparent to-transparent ring-1 ring-emerald-500/20"
            : "relative overflow-hidden border-0 bg-gradient-to-br from-rose-500/15 via-transparent to-transparent ring-1 ring-rose-500/20"
        }
      >
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">وضعیت تراز دفاتر</span>
            <span
              className={
                balanced
                  ? "text-lg font-bold text-emerald-600 dark:text-emerald-400"
                  : "text-lg font-bold text-rose-600 dark:text-rose-400"
              }
            >
              {balanced ? "تراز" : "ناتراز"}
            </span>
          </div>
          <span
            className={
              balanced
                ? "flex size-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500"
                : "flex size-10 items-center justify-center rounded-xl bg-rose-500/15 text-rose-500"
            }
          >
            {balanced ? (
              <BadgeCheck className="size-5" />
            ) : (
              <TriangleAlert className="size-5" />
            )}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}