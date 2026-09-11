"use client";

import { BarChart3, TriangleAlert } from "lucide-react";

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
import { formatRial } from "@/lib/format";
import type { FifoValuationResponse } from "@/types/inventory";

interface FifoValuationReportProps {
  valuation: FifoValuationResponse | null;
  isLoading: boolean;
  errorMessage: string | null;
  onRefresh: () => void;
}

/**
 * گزارش ارزش موجودی انبار بر پایه FIFO به تفکیک کالا.
 */
export function FifoValuationReport({
  valuation,
  isLoading,
  errorMessage,
  onRefresh,
}: FifoValuationReportProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="size-4 text-emerald-500" />
            گزارش ارزش موجودی بر پایه FIFO
          </CardTitle>
          <div className="flex items-center gap-3">
            {valuation && (
              <Badge variant="secondary">
                ارزش کل: {formatRial(valuation.totalInventoryValue)}
              </Badge>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={isLoading}
            >
              بروزرسانی
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {errorMessage && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>خطا در دریافت گزارش ارزش موجودی</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">شناسه کالا</TableHead>
                  <TableHead className="min-w-48">نام کالا</TableHead>
                  <TableHead className="w-28">موجودی ثبت‌شده</TableHead>
                  <TableHead className="w-28">موجودی لایه‌ها</TableHead>
                  <TableHead className="w-40">میانگین بهای واحد</TableHead>
                  <TableHead className="w-40">ارزش FIFO</TableHead>
                  <TableHead className="w-28">لایه‌ها</TableHead>
                  <TableHead className="w-24">وضعیت</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {valuation && valuation.rows.length > 0 ? (
                  valuation.rows.map((row) => (
                    <TableRow key={row.sku}>
                      <TableCell className="font-mono text-xs">
                        {row.sku}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.name}
                      </TableCell>
                      <TableCell>
                        {row.quantity.toLocaleString("fa-IR", {
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.batchQuantity.toLocaleString("fa-IR", {
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell>
                        {formatRial(row.weightedAverageUnitCost)}
                      </TableCell>
                      <TableCell className="font-semibold">
                        {formatRial(row.fifoValue)}
                      </TableCell>
                      <TableCell>
                        {row.openBatchCount.toLocaleString("fa-IR")}
                      </TableCell>
                      <TableCell>
                        {row.isLowStock ? (
                          <Badge variant="destructive">
                            <TriangleAlert />
                            کسری
                          </Badge>
                        ) : (
                          <Badge variant="secondary">متعادل</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-muted-foreground"
                    >
                      داده‌ای برای ارزش‌گذاری موجود است.
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
