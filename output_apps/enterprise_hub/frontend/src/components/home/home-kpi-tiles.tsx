"use client";

import Link from "next/link";
import {
  AlertCircle,
  Calculator,
  ChevronLeft,
  Landmark,
  TrendingUp,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatKpiDisplay } from "@/lib/home-hub";

export interface HomeKpiTileProps {
  label: string;
  value: string | number | null | undefined;
  hint: string;
  href: string;
  icon: React.ReactNode;
  isConfidential?: boolean;
}

function KpiTile({
  label,
  value,
  hint,
  href,
  icon,
  isConfidential = false,
}: HomeKpiTileProps) {
  const displayVal = formatKpiDisplay(value, isConfidential);

  return (
    <Link
      href={href}
      className="group block rounded-xl focus-visible:outline-2 focus-visible:outline-primary"
    >
      <Card className="h-full border border-border/70 bg-card transition-all hover:border-primary/40 hover:shadow-sm">
        <CardContent className="flex flex-col justify-between gap-3 p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="text-primary/80 group-hover:text-primary transition-colors">
                {icon}
              </span>
              {label}
            </span>
            <ChevronLeft className="size-3.5 opacity-60 transition-transform group-hover:-translate-x-0.5 group-hover:opacity-100" />
          </div>

          <div className="flex flex-col gap-0.5">
            <span
              className="text-xl font-bold tracking-tight text-foreground tabular-nums"
              dir={isConfidential ? "rtl" : "ltr"}
            >
              {displayVal}
            </span>
            <span className="text-xs text-muted-foreground">{hint}</span>
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
  isProfitConfidential = false,
  loading = false,
}: {
  cashNow?: string | number | null;
  salesToday?: string | number | null;
  profitThisMonth?: string | number | null;
  overdueReceivables?: string | number | null;
  isProfitConfidential?: boolean;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          شاخص‌های کلیدی عملکرد (KPI)
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="موجودی نقد و بانک"
          value={cashNow}
          hint="مجموع صندوق‌ها و حساب‌های بانکی"
          href="/app/accounting/reports"
          icon={<Landmark className="size-4" />}
        />

        <KpiTile
          label="فروش امروز"
          value={salesToday}
          hint="فاکتورهای صادرشده امروز"
          href="/app/invoicing"
          icon={<TrendingUp className="size-4" />}
        />

        <KpiTile
          label="سود این ماه"
          value={profitThisMonth}
          hint="سود خالص دوره جاری"
          href="/app/accounting/reports"
          icon={<Calculator className="size-4" />}
          isConfidential={isProfitConfidential}
        />

        <KpiTile
          label="مطالبات معوق"
          value={overdueReceivables}
          hint="صورتحساب‌های گذشته از موعد"
          href="/app/invoicing?status=OVERDUE"
          icon={<AlertCircle className="size-4" />}
        />
      </div>
    </section>
  );
}
