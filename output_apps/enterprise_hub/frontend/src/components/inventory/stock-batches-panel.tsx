"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers3, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listStockItemBatches } from "@/lib/api/inventory-client";
import { ApiClientError } from "@/lib/api/http-client";
import { formatPersianDate, formatRial } from "@/lib/format";
import type { FifoBatch } from "@/types/inventory";

interface StockBatchesPanelProps {
  sku: string;
  refreshKey: number;
  onClose: () => void;
}

/**
 * پنل لایه‌های FIFO باز یک کالا به‌ترتیب قدیمی‌ترین (ترتیب مصرف).
 */
export function StockBatchesPanel({
  sku,
  refreshKey,
  onClose,
}: StockBatchesPanelProps) {
  const [batches, setBatches] = useState<FifoBatch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);
    listStockItemBatches(sku, signal)
      .then((response) => setBatches(response))
      .catch((error) => {
        if (error instanceof DOMException) return;
        setErrorMessage(
          error instanceof ApiClientError
            ? error.details.join(" | ")
            : "ارتباط با سرور برقرار نشد.",
        );
      })
      .finally(() => setIsLoading(false));
  }, [sku]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  const totalRemaining = batches.reduce(
    (sum, batch) => sum + batch.quantityRemaining,
    0,
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Layers3 className="size-4 text-amber-500" />
            لایه‌های FIFO کالای{" "}
            <span className="font-mono text-xs">{sku}</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              باقی‌مانده کل: {totalRemaining.toLocaleString("fa-IR")}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              title="بستن"
            >
              <X />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {errorMessage && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>خطا در دریافت لایه‌های FIFO</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-44">شماره دسته</TableHead>
                  <TableHead className="w-36">تاریخ دریافت</TableHead>
                  <TableHead className="w-28">باقی‌مانده</TableHead>
                  <TableHead className="w-40">بهای واحد</TableHead>
                  <TableHead className="w-40">ارزش باقی‌مانده</TableHead>
                  <TableHead className="w-40">انبار</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.length > 0 ? (
                  batches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="font-mono text-xs">
                        {batch.batchNumber}
                      </TableCell>
                      <TableCell>
                        {formatPersianDate(batch.receivedDate)}
                      </TableCell>
                      <TableCell>
                        {batch.quantityRemaining.toLocaleString("fa-IR", {
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell>
                        {formatRial(batch.unitPurchaseCost)}
                      </TableCell>
                      <TableCell>{formatRial(batch.remainingValue)}</TableCell>
                      <TableCell>
                        {batch.warehouseName ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-muted-foreground"
                    >
                      لایه FIFO بازی برای این کالا وجود ندارد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
