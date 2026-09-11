"use client";

import {
  CircleDollarSign,
  HandCoins,
  Percent,
  TrendingUp,
  Users,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatRial } from "@/lib/format";
import type { LeadStats } from "@/types/crm";
import {
  PIPELINE_STAGE_LABELS,
  PipelineStage,
} from "@/types/crm";

interface CrmStatsProps {
  stats: LeadStats | null;
}

/**
 * کارت‌های بنتو (Bento) تحلیل درآمد بالقوه و نرخ تبدیل فروش:
 * ارزش فرصت‌های باز، درآمد تحقق‌یافته، نرخ تبدیل و حجم سرنخ‌ها.
 */
export function CrmStats({ stats }: CrmStatsProps) {
  const openValue = stats?.openPipelineValue ?? 0;
  const wonRevenue = stats?.wonRevenue ?? 0;
  const conversionRate = stats?.conversionRate ?? 0;
  const openLeads = stats?.openLeads ?? 0;
  const totalLeads = stats?.totalLeads ?? 0;
  const wonLeads = stats?.wonLeads ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-emerald-500/15 via-transparent to-transparent ring-1 ring-emerald-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              درآمد بالقوه فرصت‌های باز
            </span>
            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {formatRial(openValue)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {openLeads.toLocaleString("fa-IR")} فرصت باز
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
            <HandCoins className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-indigo-500/15 via-transparent to-transparent ring-1 ring-indigo-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">نرخ تبدیل فروش</span>
            <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {conversionRate.toLocaleString("fa-IR")}٪
            </span>
            <span className="text-[11px] text-muted-foreground">
              {wonLeads.toLocaleString("fa-IR")} از{" "}
              {totalLeads.toLocaleString("fa-IR")} سرنخ برنده شد
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-500">
            <TrendingUp className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-sky-500/15 via-transparent to-transparent ring-1 ring-sky-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">درآمد تحقق‌یافته</span>
            <span className="text-lg font-bold text-sky-600 dark:text-sky-400">
              {formatRial(wonRevenue)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              میانگین هر معامله{" "}
              {formatRial(stats?.averageDealValue ?? 0)}
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-500">
            <CircleDollarSign className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-violet-500/15 via-transparent to-transparent ring-1 ring-violet-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">کل سرنخ‌های پایپ‌لاین</span>
            <span className="text-2xl font-bold text-violet-600 dark:text-violet-400">
              {totalLeads.toLocaleString("fa-IR")}
            </span>
            <span className="text-[11px] text-muted-foreground">
              نرخ برد معاملات بسته{" "}
              {(stats?.winRate ?? 0).toLocaleString("fa-IR")}٪
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-500">
            <Users className="size-5" />
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * نمودار میله‌ای سهم ارزش هر مرحله از کل پایپ‌لاین
 * (تحلیل پتانسیل درآمد به تفکیک مرحله فروش).
 */
export function PipelineBreakdown({ stats }: CrmStatsProps) {
  const byStage = stats?.byStage ?? [];
  const totalValue = stats?.totalPipelineValue ?? 0;

  return (
    <Card className="h-full">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-sm font-semibold">
              تحلیل پتانسیل درآمد به تفکیک مرحله
            </span>
            <span className="text-xs text-muted-foreground">
              ارزش کل پایپ‌لاین {formatRial(totalValue)}
            </span>
          </div>
          <Percent className="size-4 text-muted-foreground" />
        </div>

        <div className="flex flex-col gap-3">
          {byStage.map((metric) => (
            <div key={metric.stage} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  {PIPELINE_STAGE_LABELS[metric.stage]}
                </span>
                <span className="text-muted-foreground">
                  {metric.count.toLocaleString("fa-IR")} سرنخ ·{" "}
                  {formatRial(metric.value)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={
                    metric.stage === PipelineStage.WON
                      ? "h-full rounded-full bg-emerald-500"
                      : metric.stage === PipelineStage.LOST
                        ? "h-full rounded-full bg-rose-500"
                        : "h-full rounded-full bg-indigo-500"
                  }
                  style={{
                    width: `${Math.max(metric.share, metric.count > 0 ? 3 : 0)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
