"use client";

import { PackageSearch, TriangleAlert } from "lucide-react";

import { MinQuantityEditor } from "@/components/inventory/min-quantity-editor";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { stockStatus, STOCK_STATUS_LABEL } from "@/lib/stock-status";
import type { StockItem } from "@/types/inventory";

interface StockItemsTableProps {
  items: StockItem[];
  isLoading: boolean;
  errorMessage: string | null;
  selectedSku: string | null;
  onSelectItem: (sku: string) => void;
  onRefresh: () => void;
}

function quantityLabel(value: number): string {
  return value.toLocaleString("fa-IR", { maximumFractionDigits: 2 });
}

/**
 * جدول کالاهای موجود انبار با نمایش هشدار کسری و ارزش FIFO هر کالا.
 * انتخاب هر ردیف، لایه‌های FIFO آن کالا را باز می‌کند.
 */
export function StockItemsTable({
  items,
  isLoading,
  errorMessage,
  selectedSku,
  onSelectItem,
  onRefresh,
}: StockItemsTableProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">کالاها و موجودی</h2>
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

      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>خطا در دریافت فهرست کالاها</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[40rem]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">شناسه کالا</TableHead>
              <TableHead className="min-w-48">نام کالا</TableHead>
              <TableHead className="w-28">موجودی</TableHead>
              <TableHead className="w-36">حداقل موجودی</TableHead>
              <TableHead className="w-36">ارزش (FIFO)</TableHead>
              <TableHead className="w-32">وضعیت</TableHead>
              <TableHead className="w-20">
                <span className="sr-only">عملیات کالا</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {Array.from({ length: 7 }).map((__, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : items.length > 0 ? (
              items.map((item) => (
                <TableRow
                  key={item.id}
                  data-state={selectedSku === item.sku ? "selected" : undefined}
                  className={
                    selectedSku === item.sku
                      ? "cursor-pointer bg-muted/50"
                      : "cursor-pointer"
                  }
                  onClick={() => onSelectItem(item.sku)}
                >
                  <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {item.name}
                    {item.barcode && (
                      <div dir="ltr" className="text-xs text-muted-foreground">
                        {item.barcode}
                      </div>
                    )}
                  </TableCell>
                  <TableCell
                    className={
                      item.isLowStock
                        ? "font-bold text-rose-700 dark:text-rose-300 tabular-nums"
                        : "font-medium tabular-nums"
                    }
                  >
                    {quantityLabel(item.quantity)}
                  </TableCell>
                  <TableCell>
                    <MinQuantityEditor itemId={item.id} value={item.minQuantity} onSaved={onRefresh} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatRial(item.fifoValuation)}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const status = stockStatus(item);
                      return status === "empty" ? (
                        <Badge variant="outline" className="gap-1">
                          <PackageSearch className="size-3" />
                          {STOCK_STATUS_LABEL.empty}
                        </Badge>
                      ) : status === "low" ? (
                        <Badge variant="destructive" className="gap-1">
                          <TriangleAlert className="size-3" />
                          {STOCK_STATUS_LABEL.low}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          {STOCK_STATUS_LABEL.ok}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <RowActionsMenu
                      label={`عملیات کالا ${item.name}`}
                      actions={[{ label: "کارت کالا", onSelect: () => onSelectItem(item.sku) }]}
                    />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                    <PackageSearch className="size-8" />
                    <span>کالایی در فهرست انبار ثبت نشده است.</span>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}