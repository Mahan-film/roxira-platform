"use client";

import {
  BadgeDollarSign,
  BriefcaseBusiness,
  ReceiptText,
  UsersRound,
  Wallet,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatRial } from "@/lib/format";
import type { HrStats } from "@/types/hr";

interface HrStatsProps {
  stats: HrStats | null;
}

/**
 * کارت‌های بنتو (Bento) تحلیل منابع انسانی: حجم پرسنل، قراردادهای فعال،
 * جمع حقوق پایه ماهانه، جمع هزینه حقوق و خالص پرداختی تجمعی.
 */
export function HrStatsCards({ stats }: HrStatsProps) {
  const totalEmployees = stats?.totalEmployees ?? 0;
  const activeEmployees = stats?.activeEmployees ?? 0;
  const activeContracts = stats?.activeContracts ?? 0;
  const totalBaseSalary = stats?.totalBaseSalary ?? 0;
  const totalGrossPay = stats?.totalGrossPay ?? 0;
  const totalNetPay = stats?.totalNetPay ?? 0;
  const totalDeductions = stats?.totalDeductions ?? 0;
  const totalPayslips = stats?.totalPayslips ?? 0;
  const averageNetPay = stats?.averageNetPay ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-indigo-500/15 via-transparent to-transparent ring-1 ring-indigo-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">کل پرسنل</span>
            <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {totalEmployees.toLocaleString("fa-IR")}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {activeEmployees.toLocaleString("fa-IR")} نفر شاغل
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-500">
            <UsersRound className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-violet-500/15 via-transparent to-transparent ring-1 ring-violet-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">قراردادهای فعال</span>
            <span className="text-2xl font-bold text-violet-600 dark:text-violet-400">
              {activeContracts.toLocaleString("fa-IR")}
            </span>
            <span className="text-[11px] text-muted-foreground">
              جمع پایه {formatRial(totalBaseSalary)}
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-500">
            <BriefcaseBusiness className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-emerald-500/15 via-transparent to-transparent ring-1 ring-emerald-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              جمع حقوق و مزایای صادرشده
            </span>
            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {formatRial(totalGrossPay)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {totalPayslips.toLocaleString("fa-IR")} فیش حقوقی
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
            <BadgeDollarSign className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-sky-500/15 via-transparent to-transparent ring-1 ring-sky-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">خالص پرداختی تجمعی</span>
            <span className="text-lg font-bold text-sky-600 dark:text-sky-400">
              {formatRial(totalNetPay)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              میانگین هر فیش {formatRial(averageNetPay)}
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-500">
            <Wallet className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card className="sm:col-span-2 lg:col-span-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <ReceiptText className="size-4 text-amber-500" />
            مجموع کسورات بیمه، مالیات و سایر (تجمعی فیش‌های صادرشده)
          </span>
          <span className="font-bold text-amber-600 dark:text-amber-400">
            {formatRial(totalDeductions)}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
