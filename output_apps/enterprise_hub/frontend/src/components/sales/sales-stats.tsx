"use client";

import { CheckCircle2, FileText, ShoppingCart, Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatNumber } from "@/lib/fa-format";

interface SalesStatsProps {
  orderCount: number;
  confirmedOrderCount: number;
  quotationCount: number;
  deliveryCount: number;
}

export function SalesStats({
  orderCount,
  confirmedOrderCount,
  quotationCount,
  deliveryCount,
}: SalesStatsProps) {
  const cards = [
    {
      label: "کل سفارش‌های فروش",
      value: formatNumber(orderCount),
      icon: ShoppingCart,
      color: "text-blue-600 bg-blue-50 dark:bg-blue-950/40",
      hint: "سفارش‌های مستقیم یا تبدیل‌شده",
    },
    {
      label: "سفارش‌های تأییدشده",
      value: formatNumber(confirmedOrderCount),
      icon: CheckCircle2,
      color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40",
      hint: "آماده صدور حواله تحویل",
    },
    {
      label: "پیش‌فاکتورها",
      value: formatNumber(quotationCount),
      icon: FileText,
      color: "text-purple-600 bg-purple-50 dark:bg-purple-950/40",
      hint: "استعلام قیمت مشتریان",
    },
    {
      label: "حواله‌های تحویل کالا",
      value: formatNumber(deliveryCount),
      icon: Truck,
      color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40",
      hint: "خروج انبار و بهای تمام‌شده",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="sales-stats">
      {cards.map((c, i) => {
        const Icon = c.icon;
        return (
          <Card key={i} className="transition-all hover:shadow-xs">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{c.value}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{c.hint}</p>
              </div>
              <div className={`p-2.5 rounded-xl ${c.color}`}>
                <Icon className="size-5" aria-hidden="true" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
