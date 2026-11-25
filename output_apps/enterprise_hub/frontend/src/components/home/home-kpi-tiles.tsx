"use client";

import Link from "next/link";
import {
  AlertCircle,
  Boxes,
  Calculator,
  ChevronLeft,
  CreditCard,
  Landmark,
  Receipt,
  TrendingUp,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { type MoneyUnit } from "@/lib/fa-format";
import { formatKpiDisplay } from "@/lib/home-hub";
import { nextDeadlineView } from "@/lib/tax-deadline";

export interface HomeKpiTileProps {
  label: string;
  value: string | number | null | undefined;
  hint: string;
  href: string;
  icon: React.ReactNode;
  unit?: MoneyUnit;
  isConfidential?: boolean;
}

function KpiTile({
  label,
  value,
  hint,
  href,
  icon,
  unit = "rial",
  isConfidential = false,
}: HomeKpiTileProps) {
  const displayVal = formatKpiDisplay(value, isConfidential, unit);

  return (
    <Link
      href={href}
      className="group block min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-primary"
    >
      <Card className="h-full border border-border bg-card transition-colors hover:border-primary/40">
        <CardContent className="flex flex-col justify-between gap-3 p-4">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              <span className="shrink-0 text-primary transition-colors">
                {icon}
              </span>
              <span className="truncate">{label}</span>
            </span>
            <ChevronLeft
              className="size-3.5 shrink-0 opacity-60 transition-transform group-hover:-translate-x-0.5 group-hover:opacity-100"
              aria-hidden="true"
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="num text-xl font-bold text-foreground tabular-nums">
              {displayVal}
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              {hint}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function HomeKpiTiles({
  cashNow,
  salesToday,
  profitThisMonth,
  overdueReceivables,
  payables,
  taxDue,
  inventory,
  periodTo,
  unit = "rial",
  isProfitConfidential = false,
  loading = false,
}: {
  cashNow?: string | number | null;
  salesToday?: string | number | null;
  profitThisMonth?: string | number | null;
  overdueReceivables?: string | number | null;
  payables?: string | number | null;
  taxDue?: string | number | null;
  inventory?: string | number | null;
  periodTo?: string | null;
  unit?: MoneyUnit;
  isProfitConfidential?: boolean;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <section aria-label="شاخص‌های کلیدی عملکرد" className="flex flex-col gap-2.5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  const deadline = nextDeadlineView({ periodTo, loading: false });
  const vatHint =
    deadline.state === "ready" && deadline.dateLabel
      ? `پایان دوره: ${deadline.dateLabel} · ${deadline.note}`
      : deadline.note;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-foreground">
          شاخص‌های کلیدی مالی
        </h2>
        {inventory !== undefined && inventory !== null && (
          <Link
            href="/app/inventory/reports"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Boxes className="size-3.5 text-primary" aria-hidden="true" />
            <span>موجودی کالا:</span>
            <strong className="num font-semibold text-foreground tabular-nums">
              {formatKpiDisplay(inventory, false, unit)}
            </strong>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiTile
          label="موجودی نقد و بانک"
          value={cashNow}
          hint="مجموع صندوق‌ها، تنخواه و حساب‌های بانکی"
          href="/app/accounting/reports?tab=cash-flow"
          icon={<Landmark className="size-4" aria-hidden="true" />}
          unit={unit}
        />

        <KpiTile
          label="فروش دوره"
          value={salesToday}
          hint="جمع فروش ثبت‌شده در اسناد دوره جاری"
          href="/app/invoicing"
          icon={<TrendingUp className="size-4" aria-hidden="true" />}
          unit={unit}
        />

        <KpiTile
          label="سود خالص دوره"
          value={profitThisMonth}
          hint="سود یا زیان خالص محاسبه‌شده از دفتر"
          href="/app/accounting/reports?tab=income-statement"
          icon={<Calculator className="size-4" aria-hidden="true" />}
          unit={unit}
          isConfidential={isProfitConfidential}
        />

        <KpiTile
          label="مطالبات و سررسیدگذشته"
          value={overdueReceivables}
          hint="مانده حساب‌های دریافتنی و پیگیری معوقات"
          href="/app/accounting/reports?tab=ageing"
          icon={<AlertCircle className="size-4" aria-hidden="true" />}
          unit={unit}
        />

        <KpiTile
          label="بدهی‌ها و معوقات"
          value={payables}
          hint="بدهی به تأمین‌کنندگان و مانده سررسیدگذشته"
          href="/app/accounting/reports?tab=ageing"
          icon={<CreditCard className="size-4" aria-hidden="true" />}
          unit={unit}
        />

        <KpiTile
          label="مالیات ارزش افزوده و مهلت"
          value={taxDue}
          hint={vatHint}
          href="/app/tax"
          icon={<Receipt className="size-4" aria-hidden="true" />}
          unit={unit}
        />
      </div>
    </section>
  );
}
