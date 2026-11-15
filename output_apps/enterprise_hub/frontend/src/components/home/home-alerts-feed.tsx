"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  CreditCard,
  FileCheck2,
  Landmark,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/fa-format";
import type { HomeAlertItem } from "@/lib/home-hub";

function renderAlertIcon(iconName: string) {
  switch (iconName) {
    case "CreditCard":
      return <CreditCard className="size-4 text-amber-500" aria-hidden="true" />;
    case "Landmark":
      return <Landmark className="size-4 text-sky-500" aria-hidden="true" />;
    case "FileCheck2":
      return <FileCheck2 className="size-4 text-amber-500" aria-hidden="true" />;
    case "AlertTriangle":
      return <AlertTriangle className="size-4 text-rose-500" aria-hidden="true" />;
    case "Boxes":
      return <Boxes className="size-4 text-amber-500" aria-hidden="true" />;
    default:
      return <AlertTriangle className="size-4 text-primary" aria-hidden="true" />;
  }
}

function getBadgeVariant(severity: HomeAlertItem["severity"]): "default" | "destructive" | "secondary" | "outline" {
  switch (severity) {
    case "destructive":
      return "destructive";
    case "warning":
      return "secondary";
    default:
      return "outline";
  }
}

export function HomeAlertsFeed({
  alerts,
  loading = false,
}: {
  alerts: HomeAlertItem[];
  loading?: boolean;
}) {
  return (
    <Card className="h-full border border-border/70 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-bold">خوراک هشدارها و پیگیری‌ها</CardTitle>
          {!loading && (
            <Badge
              variant={alerts.length > 0 ? "secondary" : "outline"}
              className="text-xs font-semibold tabular-nums"
            >
              {formatNumber(alerts.length)} مورد
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-2.5 pt-0">
        {loading ? (
          <div className="flex flex-col gap-2.5">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-500/30 bg-emerald-500/5 py-8 text-center">
            <CheckCircle2 className="size-8 text-emerald-500" aria-hidden="true" />
            <span className="text-sm font-semibold text-foreground">
              همهٔ وضعیت‌ها به‌روز هستند
            </span>
            <span className="text-xs text-muted-foreground">
              موردی برای پیگیری فوری یا مغایرت حل‌نشده وجود ندارد.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {alerts.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="group flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/60 p-3 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-md bg-muted/60 p-1.5 ring-1 ring-border/50">
                    {renderAlertIcon(item.iconName)}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                        {item.title}
                      </span>
                      <Badge
                        variant={getBadgeVariant(item.severity)}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {formatNumber(item.count)}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground line-clamp-1">
                      {item.description}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-xs font-medium text-primary opacity-80 group-hover:opacity-100 shrink-0">
                  <span>{item.actionLabel}</span>
                  <ChevronLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
