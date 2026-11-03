"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, Search, TriangleAlert, Warehouse } from "lucide-react";

import {
  ErrorNotice,
  LoadingLine,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { EmptyState } from "@/components/app/empty-state";
import { InventoryAdminPanel } from "@/components/inventory/inventory-admin-panel";
import { InventoryStats } from "@/components/inventory/inventory-stats";
import { StockBatchesPanel } from "@/components/inventory/stock-batches-panel";
import { StockItemsTable } from "@/components/inventory/stock-items-table";
import { WarehousesManager } from "@/components/inventory/warehouses-manager";
import { WarehouseStockPanel } from "@/components/inventory/warehouse-stock-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getFifoValuation,
  listStockItems,
  listWarehouses,
} from "@/lib/api/inventory-client";
import type {
  FifoValuationResponse,
  StockItem,
  Warehouse as WarehouseModel,
} from "@/types/inventory";

export default function SuiteInventoryPage() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseModel[]>([]);
  const [valuation, setValuation] = useState<FifoValuationResponse | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listStockItems(
        { page: 1, limit: 100, search: search || undefined, lowStockOnly },
        controller.signal,
      ),
      listWarehouses(controller.signal),
      getFifoValuation(controller.signal),
    ])
      .then(([itemsResult, warehousesResult, valuationResult]) => {
        setItems(itemsResult.data);
        setWarehouses(warehousesResult);
        setValuation(valuationResult);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(loadErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [search, lowStockOnly, refreshKey]);

  const isEmpty = !loading && !error && items.length === 0 && !search && !lowStockOnly;

  return (
    <>
      <PageHeader
        title="کالا و انبار"
        description="کالاها، انبارها و موجودی با ارزش‌گذاری FIFO"
        icon={<Warehouse className="size-6 text-indigo-500" />}
      />

      <ErrorNotice title="خطا در دریافت اطلاعات انبار" message={error} />

      <InventoryStats
        valuation={valuation}
        warehouseCount={warehouses.length}
        lowStockCount={valuation?.lowStockCount ?? 0}
      />

      <InventoryAdminPanel onChanged={refresh} />

      <WarehousesManager warehouses={warehouses} onChanged={refresh} />

      {isEmpty ? (
        <EmptyState
          icon={<Warehouse className="size-6 text-indigo-500" aria-hidden="true" />}
          description="مدیریت فهرست کالاها، انبارها و ارزش‌گذاری موجودی به روش FIFO در این بخش انجام می‌شود."
          action={
            <Link href="/app/import" className={buttonVariants()}>
              <FileSpreadsheet aria-hidden="true" />
              ورود اطلاعات از فایل
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="جست‌وجوی کد کالا، بارکد یا نام"
                className="ps-8"
                aria-label="جست‌وجوی کالا"
              />
            </div>
            <Button
              variant={lowStockOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setLowStockOnly((v) => !v)}
            >
              <TriangleAlert />
              فقط کسری
            </Button>
            <LoadingLine show={loading} />
          </div>

          <StockItemsTable
            items={items}
            isLoading={loading}
            errorMessage={null}
            selectedSku={selectedSku}
            onSelectItem={(sku) => setSelectedSku((cur) => (cur === sku ? null : sku))}
            onRefresh={refresh}
          />

          {selectedSku && (
            <StockBatchesPanel
              sku={selectedSku}
              refreshKey={refreshKey}
              onClose={() => setSelectedSku(null)}
            />
          )}

          <WarehouseStockPanel warehouses={warehouses} refreshKey={refreshKey} />
        </>
      )}
    </>
  );
}
