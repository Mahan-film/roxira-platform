"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Warehouse } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getWarehouseStock } from "@/lib/api/inventory-client";
import { ApiClientError } from "@/lib/api/http-client";
import { formatRial } from "@/lib/format";
import type {
  Warehouse as WarehouseModel,
  WarehouseStockResponse,
} from "@/types/inventory";

interface WarehouseStockPanelProps {
  warehouses: WarehouseModel[];
  refreshKey: number;
}

/**
 * استعلام موجودی یک انبار مشخص به تفکیک کالا و ارزش FIFO.
 */
export function WarehouseStockPanel({
  warehouses,
  refreshKey,
}: WarehouseStockPanelProps) {
  const [selectedId, setSelectedId] = useState<number | null>(
    warehouses.length > 0 ? warehouses[0].id : null,
  );
  const [stock, setStock] = useState<WarehouseStockResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId === null && warehouses.length > 0) {
      setSelectedId(warehouses[0].id);
    }
  }, [warehouses, selectedId]);

  const loadStock = useCallback(
    (id: number, signal?: AbortSignal) => {
      setIsLoading(true);
      setErrorMessage(null);
      getWarehouseStock(id, signal)
        .then((response) => setStock(response))
        .catch((error) => {
          if (error instanceof DOMException) return;
          setErrorMessage(
            error instanceof ApiClientError
              ? error.details.join(" | ")
              : "ارتباط با سرور برقرار نشد.",
          );
        })
        .finally(() => setIsLoading(false));
    },
    [],
  );

  useEffect(() => {
    if (selectedId === null) {
      setStock(null);
      return;
    }
    const controller = new AbortController();
    loadStock(selectedId, controller.signal);
    return () => controller.abort();
  }, [selectedId, loadStock, refreshKey]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-sky-500" />
            استعلام موجودی انبار
          </CardTitle>
          <div className="w-full sm:w-72">
            <Select<string>
              value={selectedId !== null ? String(selectedId) : null}
              onValueChange={(value) =>
                setSelectedId(value ? Number(value) : null)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="انتخاب انبار" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                    {warehouse.name} ({warehouse.locationCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {warehouses.length === 0 && (
          <Alert>
            <Warehouse className="size-4" />
            <AlertTitle>انباری تعریف نشده است</AlertTitle>
            <AlertDescription>
              ابتدا از پنل مدیریت پایه انبار، یک انبار جدید تعریف کنید.
            </AlertDescription>
          </Alert>
        )}

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>خطا در استعلام موجودی</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : stock ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-3">
                <span className="text-xs text-muted-foreground">نام انبار</span>
                <p className="font-semibold">{stock.warehouseName}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <span className="text-xs text-muted-foreground">تعداد اقلام</span>
                <p className="font-semibold">
                  {stock.itemCount.toLocaleString("fa-IR")}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <span className="text-xs text-muted-foreground">ارزش کل انبار</span>
                <p className="font-semibold">{formatRial(stock.totalValue)}</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">شناسه کالا</TableHead>
                    <TableHead className="min-w-48">نام کالا</TableHead>
                    <TableHead className="w-28">موجودی</TableHead>
                    <TableHead className="w-36">ارزش FIFO</TableHead>
                    <TableHead className="w-28">لایه‌های باز</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stock.rows.length > 0 ? (
                    stock.rows.map((row) => (
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
                        <TableCell>{formatRial(row.fifoValue)}</TableCell>
                        <TableCell>
                          {row.openBatchCount.toLocaleString("fa-IR")}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-8 text-center text-muted-foreground"
                      >
                        این انبار موجودی فعالی ندارد.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
