"use client";

import {
  Boxes,
  CircleDollarSign,
  Layers3,
  TriangleAlert,
  Warehouse,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatRial } from "@/lib/format";
import type { FifoValuationResponse } from "@/types/inventory";

interface InventoryStatsProps {
  valuation: FifoValuationResponse | null;
  warehouseCount: number;
  lowStockCount: number;
}

/**
 * کارت‌های بنتو (Bento) خلاصه وضعیت انبار:
 * تعداد کالاها، ارزش موجودی FIFO، تعداد انبارها و کالاهای دچار کسری.
 */
export function InventoryStats({
  valuation,
  warehouseCount,
  lowStockCount,
}: InventoryStatsProps) {
  const itemCount = valuation?.itemCount ?? 0;
  const totalValue = valuation?.totalInventoryValue ?? 0;
  const totalOpenBatches = valuation?.totalOpenBatches ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-indigo-500/15 via-transparent to-transparent ring-1 ring-indigo-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">تعداد کالاهای انبار</span>
            <span className="text-2xl font-bold">
              {itemCount.toLocaleString("fa-IR")}
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-500">
            <Boxes className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-emerald-500/15 via-transparent to-transparent ring-1 ring-emerald-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">ارزش موجودی بر پایه FIFO</span>
            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {formatRial(totalValue)}
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
            <CircleDollarSign className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-sky-500/15 via-transparent to-transparent ring-1 ring-sky-500/20">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">انبارها / لایه‌های باز</span>
            <span className="text-lg font-bold text-sky-600 dark:text-sky-400">
              {warehouseCount.toLocaleString("fa-IR")} انبار ·{" "}
              {totalOpenBatches.toLocaleString("fa-IR")} لایه
            </span>
          </div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-500">
            <Warehouse className="size-5" />
          </span>
        </CardContent>
      </Card>

      <Card
        className={
          lowStockCount > 0
            ? "relative overflow-hidden border-0 bg-gradient-to-br from-rose-500/15 via-transparent to-transparent ring-1 ring-rose-500/20"
            : "relative overflow-hidden border-0 bg-gradient-to-br from-emerald-500/15 via-transparent to-transparent ring-1 ring-emerald-500/20"
        }
      >
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">کالاهای دچار کسری</span>
            <span
              className={
                lowStockCount > 0
                  ? "text-2xl font-bold text-rose-600 dark:text-rose-400"
                  : "text-2xl font-bold text-emerald-600 dark:text-emerald-400"
              }
            >
              {lowStockCount.toLocaleString("fa-IR")}
            </span>
          </div>
          <span
            className={
              lowStockCount > 0
                ? "flex size-10 items-center justify-center rounded-xl bg-rose-500/15 text-rose-500"
                : "flex size-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500"
            }
          >
            {lowStockCount > 0 ? (
              <TriangleAlert className="size-5" />
            ) : (
              <Layers3 className="size-5" />
            )}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
