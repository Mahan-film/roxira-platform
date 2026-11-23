"use client";

import { CheckCircle2, Clock, FileSpreadsheet, ShoppingBag, Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatNumber } from "@/lib/fa-format";

interface PurchasingStatsProps {
  orderCount: number;
  approvedCount: number;
  receiptCount: number;
  invoiceCount: number;
}

export function PurchasingStats({
  orderCount,
  approvedCount,
  receiptCount,
  invoiceCount,
}: PurchasingStatsProps) {
  const cards = [
    {
      label: "کل سفارش‌های خرید",
      value: formatNumber(orderCount),
      icon: ShoppingBag,
      color: "text-blue-600 bg-blue-50 dark:bg-blue-950/40",
      hint: "سفارش‌های ثبت‌شده",
    },
    {
      label: "سفارش‌های تأییدشده / باز",
      value: formatNumber(approvedCount),
      icon: Clock,
      color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40",
      hint: "آماده رسید کالا",
    },
    {
      label: "رسیدهای انبار",
      value: formatNumber(receiptCount),
      icon: Truck,
      color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40",
      hint: "ورود کالا به انبار",
    },
    {
      label: "صورتحساب‌های تأمین‌کننده",
      value: formatNumber(invoiceCount),
      icon: FileSpreadsheet,
      color: "text-purple-600 bg-purple-50 dark:bg-purple-950/40",
      hint: "تطبیق سه‌طرفه و سند",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="purchasing-stats">
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
