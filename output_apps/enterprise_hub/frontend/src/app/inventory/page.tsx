"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Layers, Search, Sparkles, TriangleAlert, Warehouse } from "lucide-react";

import { FifoValuationReport } from "@/components/inventory/fifo-valuation-report";
import { InventoryAdminPanel } from "@/components/inventory/inventory-admin-panel";
import { InventoryStats } from "@/components/inventory/inventory-stats";
import { StockBatchesPanel } from "@/components/inventory/stock-batches-panel";
import { StockItemsTable } from "@/components/inventory/stock-items-table";
import { StockMovementForm } from "@/components/inventory/stock-movement-form";
import { WarehouseStockPanel } from "@/components/inventory/warehouse-stock-panel";
import { SiteHeader } from "@/components/layout/site-header";
import { RoxiraFooter } from "@/components/layout/roxira-footer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getFifoValuation,
  listStockItems,
  listWarehouses,
} from "@/lib/api/inventory-client";
import { ApiClientError } from "@/lib/api/http-client";
import type {
  FifoValuationResponse,
  StockItem,
  Warehouse as WarehouseModel,
} from "@/types/inventory";

const ITEMS_PAGE_SIZE = 100;

/**
 * صفحه جامع انبارداری سازمانی چند‌انباره و قیمت‌گذاری FIFO.
 *
 * شامل کارت‌های بنتو خلاصه وضعیت، فرم ورود/خروج کالا با ردیابی لایه‌های FIFO،
 * جدول کالاهای موجود با هشدار کسری، استعلام موجودی انبارها و گزارش ارزش
 * موجودی — همه متصل به ماژول `enterprise-hub/inventory` در لایه NestJS.
 */
export default function InventoryPage() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseModel[]>([]);
  const [valuation, setValuation] = useState<FifoValuationResponse | null>(null);
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPending, startTransition] = useTransition();

  const loadOverview = useCallback(
    (signal?: AbortSignal) => {
      startTransition(async () => {
        try {
          const [itemsResult, warehousesResult, valuationResult] =
            await Promise.all([
              listStockItems(
                {
                  page: 1,
                  limit: ITEMS_PAGE_SIZE,
                  search: search.trim() || undefined,
                  lowStockOnly,
                },
                signal,
              ),
              listWarehouses(signal),
              getFifoValuation(signal),
            ]);
          setItems(itemsResult.data);
          setWarehouses(warehousesResult);
          setValuation(valuationResult);
          setErrorMessage(null);
        } catch (error) {
          if (error instanceof ApiClientError) {
            setErrorMessage(error.details.join(" | "));
          } else if (!(error instanceof DOMException)) {
            setErrorMessage(
              "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.",
            );
          }
        }
      });
    },
    [search, lowStockOnly],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview, refreshKey]);

  function handleRefresh() {
    setRefreshKey((key) => key + 1);
  }

  const lowStockCount = valuation?.lowStockCount ?? 0;

  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Warehouse className="size-6 text-indigo-500" />
            انبارداری سازمانی و قیمت‌گذاری FIFO
          </h1>
          <p className="text-sm text-muted-foreground">
            مدیریت چند‌انباره کالاها، ورود/خروج با مصرف First-In-First-Out و
            گزارش ارزش موجودی — متصل به{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              /enterprise-hub/inventory
            </code>
          </p>
        </div>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>خطا در دریافت اطلاعات انبار</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <InventoryStats
          valuation={valuation}
          warehouseCount={warehouses.length}
          lowStockCount={lowStockCount}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <StockMovementForm
              items={items}
              warehouses={warehouses}
              onCompleted={handleRefresh}
            />
          </div>

          <Card
            className={
              lowStockCount > 0
                ? "h-full border-0 bg-gradient-to-br from-rose-500/10 via-transparent to-transparent ring-1 ring-rose-500/20"
                : "h-full border-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent ring-1 ring-emerald-500/20"
            }
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-indigo-500" />
                راهنمای FIFO
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
              <p>
                هر ورود کالا یک «دسته» جدید با بهای خرید خودش می‌سازد؛ خروج کالا
                همیشه از قدیمی‌ترین دسته‌ها شروع می‌شود.
              </p>
              <div className="flex items-start gap-2">
                <Layers className="mt-0.5 size-4 text-amber-500" />
                <span>
                  روی هر ردیف جدول کالاها بزنید تا لایه‌های FIFO باز آن را
                  ببینید.
                </span>
              </div>
              <div className="flex items-start gap-2">
                {lowStockCount > 0 ? (
                  <TriangleAlert className="mt-0.5 size-4 text-rose-500" />
                ) : (
                  <Warehouse className="mt-0.5 size-4 text-emerald-500" />
                )}
                <span>
                  {lowStockCount > 0
                    ? `${lowStockCount.toLocaleString("fa-IR")} کالا زیر آستانه کسری است و در جدول با برچسب قرمز مشخص شده‌اند.`
                    : "هیچ کالایی زیر آستانه کسری نیست."}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <InventoryAdminPanel onChanged={handleRefresh} />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="جست‌وجوی SKU، بارکد یا نام کالا"
                className="pr-8"
              />
            </div>
            <Button
              type="button"
              variant={lowStockOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setLowStockOnly((value) => !value)}
            >
              <TriangleAlert />
              فقط کسری
            </Button>
          </div>
        </div>

        <StockItemsTable
          items={items}
          isLoading={isPending}
          errorMessage={null}
          selectedSku={selectedSku}
          onSelectItem={(sku) =>
            setSelectedSku((current) => (current === sku ? null : sku))
          }
          onRefresh={handleRefresh}
        />

        {selectedSku && (
          <StockBatchesPanel
            sku={selectedSku}
            refreshKey={refreshKey}
            onClose={() => setSelectedSku(null)}
          />
        )}

        <WarehouseStockPanel warehouses={warehouses} refreshKey={refreshKey} />

        <FifoValuationReport
          valuation={valuation}
          isLoading={isPending}
          errorMessage={null}
          onRefresh={handleRefresh}
        />
      </main>
      <RoxiraFooter />
    </div>
  );
}
