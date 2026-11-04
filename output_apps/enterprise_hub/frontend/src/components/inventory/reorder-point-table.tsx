"use client";

import { useState } from "react";
import { Download, PackageCheck } from "lucide-react";

import { loadErrorMessage } from "@/components/app/app-ui";
import { MinQuantityEditor } from "@/components/inventory/min-quantity-editor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listStockItems } from "@/lib/api/inventory-client";
import { reorderCsv, shortfall, sortByShortfall } from "@/lib/reorder";
import type { StockItem } from "@/types/inventory";

interface ReorderPointTableProps {
  items: StockItem[];
  isLoading: boolean;
  /** The current search text, so the export matches what the table shows. */
  search?: string;
  selectedSku: string | null;
  onSelectItem: (sku: string) => void;
  onChanged: () => void;
}

const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_PAGES = 50;

function quantityLabel(value: number): string {
  return value.toLocaleString("fa-IR", { maximumFractionDigits: 2 });
}

/** Every item at or below its minimum (all pages), for the CSV export. */
async function fetchAllBelowReorderPoint(search?: string): Promise<StockItem[]> {
  const all: StockItem[] = [];
  for (let page = 1; page <= EXPORT_MAX_PAGES; page += 1) {
    const result = await listStockItems({ page, limit: EXPORT_PAGE_SIZE, search, lowStockOnly: true });
    all.push(...result.data);
    if (all.length >= result.total || result.data.length === 0) break;
  }
  return all;
}

/**
 * The "below reorder point" view: items whose stock is at or below their minimum, with on hand,
 * minimum (editable), the shortfall to order, and a CSV export of the whole list.
 */
export function ReorderPointTable({
  items,
  isLoading,
  search,
  selectedSku,
  onSelectItem,
  onChanged,
}: ReorderPointTableProps) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const csv = reorderCsv(await fetchAllBelowReorderPoint(search));
      const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "below-reorder-point.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setExportError(loadErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">زیر نقطهٔ سفارش</h2>
          <p className="text-xs text-muted-foreground">
            کالاهایی که موجودی‌شان به حداقل موجودی رسیده یا کمتر شده است. کسری یعنی حداقل منهای موجودی.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={exporting || isLoading || items.length === 0}
          onClick={() => void exportCsv()}
        >
          <Download />
          {exporting ? "در حال آماده‌سازی…" : "خروجی CSV"}
        </Button>
      </div>
      {exportError && <p className="text-sm text-destructive">{exportError}</p>}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">شناسه کالا</TableHead>
              <TableHead className="min-w-48">نام کالا</TableHead>
              <TableHead className="w-28">موجودی</TableHead>
              <TableHead className="w-36">حداقل موجودی</TableHead>
              <TableHead className="w-28">کسری</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {Array.from({ length: 5 }).map((__, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : items.length > 0 ? (
              sortByShortfall(items).map((item) => (
                <TableRow
                  key={item.id}
                  data-state={selectedSku === item.sku ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => onSelectItem(item.sku)}
                >
                  <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                  <TableCell className="whitespace-nowrap">{item.name}</TableCell>
                  <TableCell className="font-medium">{quantityLabel(item.quantity)}</TableCell>
                  <TableCell>
                    <MinQuantityEditor itemId={item.id} value={item.minQuantity} onSaved={onChanged} />
                  </TableCell>
                  <TableCell className="font-bold text-rose-600 dark:text-rose-400">
                    {quantityLabel(shortfall(item))}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                    <PackageCheck className="size-8" />
                    <span>هیچ کالایی زیر نقطهٔ سفارش نیست.</span>
                    <span className="text-xs">
                      برای هر کالا در فهرست «همه» حداقل موجودی بگذارید تا اینجا هشدار بدهد.
                    </span>
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
