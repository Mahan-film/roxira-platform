"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardCheck,
  ClipboardList,
  PackagePlus,
  Search,
  TriangleAlert,
  Warehouse,
} from "lucide-react";

import {
  EmptyImportState,
  ErrorNotice,
  LoadingLine,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { InventoryStats } from "@/components/inventory/inventory-stats";
import { ItemCreateDrawer } from "@/components/inventory/item-create-drawer";
import {
  StockDocumentDrawer,
  type DocumentKind,
} from "@/components/inventory/stock-document-drawer";
import { OpeningBalanceDrawer } from "@/components/inventory/opening-balance-drawer";
import { StockBatchesPanel } from "@/components/inventory/stock-batches-panel";
import { StockDocumentsList } from "@/components/inventory/stock-documents-list";
import { StockItemsTable } from "@/components/inventory/stock-items-table";
import { WarehouseStockPanel } from "@/components/inventory/warehouse-stock-panel";
import { WarehousesManager } from "@/components/inventory/warehouses-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getFifoValuation,
  listStockItems,
  listWarehouses,
} from "@/lib/api/inventory-client";
import { formatNumber } from "@/lib/fa-format";
import type {
  FifoValuationResponse,
  StockItem,
  Warehouse as WarehouseModel,
} from "@/types/inventory";

const PAGE_SIZE = 50;

type Filter = "all" | "low" | "empty";

export default function SuiteInventoryPage() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [total, setTotal] = useState(0);
  const [noStockCount, setNoStockCount] = useState(0);
  const [page, setPage] = useState(1);
  const [warehouses, setWarehouses] = useState<WarehouseModel[]>([]);
  const [valuation, setValuation] = useState<FifoValuationResponse | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showNewItem, setShowNewItem] = useState(false);
  const [showOpening, setShowOpening] = useState(false);
  const [documentKind, setDocumentKind] = useState<DocumentKind | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listStockItems(
        {
          page,
          limit: PAGE_SIZE,
          search: search || undefined,
          lowStockOnly: filter === "low" ? true : undefined,
          noStockOnly: filter === "empty" ? true : undefined,
        },
        controller.signal,
      ),
      listWarehouses(controller.signal),
      getFifoValuation(controller.signal),
    ])
      .then(([itemsResult, warehousesResult, valuationResult]) => {
        setItems(itemsResult.data);
        setTotal(itemsResult.total);
        setNoStockCount(itemsResult.noStockCount ?? 0);
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
  }, [search, filter, page, refreshKey]);

  const isEmpty = !loading && !error && total === 0 && !search && filter === "all";
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="کالا و انبار"
        description="کالاها، انبارها، اسناد انبار و موجودی با ارزش‌گذاری FIFO"
        icon={<Warehouse className="size-6 text-indigo-500" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowNewItem(true)}>
              <PackagePlus />
              کالای جدید
            </Button>
            <Button variant="secondary" onClick={() => setDocumentKind("receipt")}>
              <ArrowDownToLine />
              رسید خرید
            </Button>
            <Button variant="secondary" onClick={() => setDocumentKind("delivery")}>
              <ArrowUpFromLine />
              حوالهٔ خروج
            </Button>
            <Button variant="secondary" onClick={() => setShowOpening(true)}>
              <ClipboardList />
              موجودی اول دوره
            </Button>
            <Button variant="outline" onClick={() => setDocumentKind("adjustment")}>
              <ClipboardCheck />
              تعدیل موجودی
            </Button>
          </div>
        }
      />

      <ErrorNotice title="خطا در دریافت اطلاعات انبار" message={error} />

      <InventoryStats
        valuation={valuation}
        warehouseCount={warehouses.length}
        lowStockCount={valuation?.lowStockCount ?? 0}
      />

      {noStockCount > 0 && filter !== "empty" && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {formatNumber(noStockCount)} کالا هیچ موجودی ثبت‌شده‌ای ندارد و ارزش FIFO آن‌ها صفر است.
          موجودی را با رسید خرید یا موجودی اول دوره وارد کنید؛ عددی از خودمان نمی‌سازیم.{" "}
          <button type="button" className="underline" onClick={() => setShowOpening(true)}>
            ثبت موجودی اول دوره
          </button>{" · "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setFilter("empty");
              setPage(1);
            }}
          >
            نمایش آن‌ها
          </button>
        </p>
      )}

      {isEmpty ? (
        <EmptyImportState
          title="فهرست کالاهای قبلی‌تان را اینجا رها کنید"
          hint="فایل اکسل کالا یا موجودی انبار را در صفحه ورود داده بارگذاری کنید"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
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
            {(["all", "low", "empty"] as Filter[]).map((key) => (
              <Button
                key={key}
                size="sm"
                variant={filter === key ? "default" : "outline"}
                onClick={() => {
                  setFilter(key);
                  setPage(1);
                }}
              >
                {key === "low" && <TriangleAlert />}
                {key === "all" ? "همه" : key === "low" ? "کسری" : "بدون موجودی"}
              </Button>
            ))}
            <LoadingLine show={loading} />
            <span className="ms-auto text-xs text-muted-foreground">{formatNumber(total)} کالا</span>
          </div>

          <StockItemsTable
            items={items}
            isLoading={loading}
            errorMessage={null}
            selectedSku={selectedSku}
            onSelectItem={(sku) => setSelectedSku((cur) => (cur === sku ? null : sku))}
            onRefresh={refresh}
          />

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                صفحه {formatNumber(page)} از {formatNumber(pageCount)}
              </span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  قبلی
                </Button>
                <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                  بعدی
                </Button>
              </div>
            </div>
          )}

          {selectedSku && (
            <StockBatchesPanel
              sku={selectedSku}
              refreshKey={refreshKey}
              onClose={() => setSelectedSku(null)}
            />
          )}
        </>
      )}

      <WarehousesManager warehouses={warehouses} onChanged={refresh} />
      <WarehouseStockPanel warehouses={warehouses} refreshKey={refreshKey} />
      <StockDocumentsList warehouses={warehouses} refreshKey={refreshKey} />

      <ItemCreateDrawer open={showNewItem} onClose={() => setShowNewItem(false)} onCreated={refresh} />
      <OpeningBalanceDrawer open={showOpening} onClose={() => setShowOpening(false)} onPosted={refresh} />
      <StockDocumentDrawer kind={documentKind} onClose={() => setDocumentKind(null)} onPosted={refresh} />
    </>
  );
}
