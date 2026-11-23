"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DollarSign,
  FileText,
  Filter,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Tag,
  Truck,
} from "lucide-react";
import { PageHeader, ErrorNotice, LoadingLine } from "@/components/app/app-ui";
import { useAccess } from "@/components/app/access-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  listSalesDeliveries,
  listSalesOrders,
  listSalesQuotations,
} from "@/lib/api/sales-client";
import { formatJalaliDate } from "@/lib/fa-format";
import { cn } from "@/lib/utils";

import { SalesStats } from "@/components/sales/sales-stats";
import { SalesOrderCreateDrawer } from "@/components/sales/sales-order-create-drawer";
import { SalesOrderDetailDrawer } from "@/components/sales/sales-order-detail-drawer";
import { QuotationCreateDrawer } from "@/components/sales/quotation-create-drawer";
import { QuotationDetailDrawer } from "@/components/sales/quotation-detail-drawer";
import { DeliveryCreateDrawer } from "@/components/sales/delivery-create-drawer";
import { DeliveryDetailDrawer } from "@/components/sales/delivery-detail-drawer";
import { PriceTiersTab } from "@/components/sales/price-tiers-tab";
import { formatSalesMoney, formatSalesQuantity } from "@/components/sales/sales-format";

import type {
  SalesDelivery,
  SalesOrder,
  SalesOrderStatus,
  SalesQuotation,
  SalesQuotationStatus,
} from "@/types/sales";

type SalesTab = "orders" | "quotations" | "deliveries" | "price-tiers";

const ORDER_STATUS_MAP: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  DRAFT: { label: "پیش‌نویس", variant: "secondary" },
  CONFIRMED: { label: "تأییدشده", variant: "default" },
  CANCELLED: { label: "لغو شده", variant: "destructive" },
};

const ORDER_FILTER_PILLS: { status?: SalesOrderStatus; label: string }[] = [
  { label: "همه" },
  { status: "DRAFT", label: "پیش‌نویس" },
  { status: "CONFIRMED", label: "تأییدشده" },
  { status: "CANCELLED", label: "لغو‌شده" },
];

const QUOTATION_STATUS_MAP: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  DRAFT: { label: "پیش‌نویس", variant: "secondary" },
  SENT: { label: "ارسال‌شده", variant: "outline" },
  ACCEPTED: { label: "تأیید مشتری", variant: "default" },
  REJECTED: { label: "رد شده", variant: "destructive" },
  CONVERTED: { label: "تبدیل به سفارش", variant: "default" },
};

const QUOTATION_FILTER_PILLS: { status?: SalesQuotationStatus; label: string }[] = [
  { label: "همه" },
  { status: "DRAFT", label: "پیش‌نویس" },
  { status: "SENT", label: "ارسال‌شده" },
  { status: "ACCEPTED", label: "تأیید مشتری" },
  { status: "REJECTED", label: "رد شده" },
  { status: "CONVERTED", label: "تبدیل‌شده" },
];

export default function SalesCyclePage() {
  const { can, loading: accessLoading } = useAccess();

  // Active tab state
  const [activeTab, setActiveTab] = useState<SalesTab>("orders");

  // Data states
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [quotations, setQuotations] = useState<SalesQuotation[]>([]);
  const [deliveries, setDeliveries] = useState<SalesDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters & search
  const [search, setSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<SalesOrderStatus | undefined>(
    undefined,
  );
  const [quotationStatusFilter, setQuotationStatusFilter] = useState<
    SalesQuotationStatus | undefined
  >(undefined);

  // Drawers state
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);

  const [isCreatingQuotation, setIsCreatingQuotation] = useState(false);
  const [selectedQuotation, setSelectedQuotation] = useState<SalesQuotation | null>(null);

  const [orderForDelivery, setOrderForDelivery] = useState<SalesOrder | null>(null);
  const [selectedDelivery, setSelectedDelivery] = useState<SalesDelivery | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Permissions (Invoicing / Accounting)
  const canRead = can("invoicing", "read") || can("accounting", "read");
  const canCreate = can("invoicing", "create") || can("accounting", "create");
  const canApprove = can("invoicing", "approve") || can("accounting", "approve");

  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    Promise.all([
      listSalesOrders(undefined, controller.signal),
      listSalesQuotations(undefined, controller.signal),
      listSalesDeliveries(undefined, controller.signal),
    ])
      .then(([ordersRes, quotesRes, delivRes]) => {
        setOrders(ordersRes.data || []);
        setQuotations(quotesRes.data || []);
        setDeliveries(delivRes.data || []);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "خطا در بارگذاری اطلاعات چرخه فروش.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [canRead, refreshKey]);

  // Filtered orders
  const filteredOrders = useMemo(() => {
    let result = orders;
    if (orderStatusFilter) {
      result = result.filter((o) => o.status === orderStatusFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (o) =>
          o.number.toLowerCase().includes(q) ||
          o.partyCode.toLowerCase().includes(q),
      );
    }
    return result;
  }, [orders, orderStatusFilter, search]);

  // Filtered quotations
  const filteredQuotations = useMemo(() => {
    let result = quotations;
    if (quotationStatusFilter) {
      result = result.filter((q) => q.status === quotationStatusFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (item) =>
          item.number.toLowerCase().includes(q) ||
          item.partyCode.toLowerCase().includes(q),
      );
    }
    return result;
  }, [quotations, quotationStatusFilter, search]);

  // Filtered deliveries
  const filteredDeliveries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deliveries;
    return deliveries.filter(
      (d) =>
        d.number.toLowerCase().includes(q) ||
        d.partyCode.toLowerCase().includes(q) ||
        String(d.orderId).includes(q),
    );
  }, [deliveries, search]);

  if (accessLoading) {
    return <LoadingLine />;
  }

  if (!canRead) {
    return (
      <div className="p-8">
        <ErrorNotice
          title="عدم دسترسی"
          message="شما دسترسی لازم برای مشاهده چرخه فروش را ندارید."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8" data-testid="sales-cycle-page">
      {/* Top Header */}
      <PageHeader
        title="چرخه فروش"
        description="پیش‌فاکتورها، سفارشات فروش، حواله‌های خروج کالا و سطوح قیمت"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={loading}
              className="gap-1.5"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              تازه‌سازی
            </Button>

            {activeTab === "orders" && canCreate && (
              <Button
                size="sm"
                onClick={() => setIsCreatingOrder(true)}
                className="gap-1.5"
                data-testid="create-sales-order-btn"
              >
                <Plus className="size-3.5" />
                ثبت سفارش فروش جدید
              </Button>
            )}

            {activeTab === "quotations" && canCreate && (
              <Button
                size="sm"
                onClick={() => setIsCreatingQuotation(true)}
                className="gap-1.5"
                data-testid="create-quotation-btn"
              >
                <Plus className="size-3.5" />
                ثبت پیش‌فاکتور جدید
              </Button>
            )}
          </div>
        }
      />

      {error && <ErrorNotice message={error} />}

      {/* KPI Stats */}
      <SalesStats orders={orders} quotations={quotations} deliveries={deliveries} />

      {/* Main Tabs Card */}
      <Card>
        <CardHeader className="border-b border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Tabs List */}
            <div className="flex items-center gap-1.5 rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setActiveTab("orders")}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  activeTab === "orders"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid="tab-orders"
              >
                <ShoppingCart className="size-3.5" />
                سفارشات فروش
                <Badge variant="secondary" className="mr-1 text-[10px]">
                  {orders.length}
                </Badge>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("quotations")}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  activeTab === "quotations"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid="tab-quotations"
              >
                <FileText className="size-3.5" />
                پیش‌فاکتورها
                <Badge variant="secondary" className="mr-1 text-[10px]">
                  {quotations.length}
                </Badge>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("deliveries")}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  activeTab === "deliveries"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid="tab-deliveries"
              >
                <Truck className="size-3.5" />
                حواله‌های تحویل
                <Badge variant="secondary" className="mr-1 text-[10px]">
                  {deliveries.length}
                </Badge>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("price-tiers")}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  activeTab === "price-tiers"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid="tab-price-tiers"
              >
                <Tag className="size-3.5" />
                سطوح قیمت و تخفیف‌ها
              </button>
            </div>

            {/* Search box (when not in price-tiers) */}
            {activeTab !== "price-tiers" && (
              <div className="relative w-full max-w-xs">
                <Search className="absolute right-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder="جستجو بر اساس شماره یا طرف‌حساب..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-9 text-xs"
                />
              </div>
            )}
          </div>

          {/* Status Filter Pills for Orders */}
          {activeTab === "orders" && (
            <div className="flex flex-wrap items-center gap-1.5 pt-3">
              <span className="text-xs font-medium text-muted-foreground">وضعیت:</span>
              {ORDER_FILTER_PILLS.map((pill) => (
                <button
                  key={pill.label}
                  type="button"
                  onClick={() => setOrderStatusFilter(pill.status)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    orderStatusFilter === pill.status
                      ? "border-primary bg-primary text-primary-foreground font-medium"
                      : "border-border bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          )}

          {/* Status Filter Pills for Quotations */}
          {activeTab === "quotations" && (
            <div className="flex flex-wrap items-center gap-1.5 pt-3">
              <span className="text-xs font-medium text-muted-foreground">وضعیت:</span>
              {QUOTATION_FILTER_PILLS.map((pill) => (
                <button
                  key={pill.label}
                  type="button"
                  onClick={() => setQuotationStatusFilter(pill.status)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    quotationStatusFilter === pill.status
                      ? "border-primary bg-primary text-primary-foreground font-medium"
                      : "border-border bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {/* TAB 1: ORDERS */}
          {activeTab === "orders" && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">شماره سفارش</TableHead>
                    <TableHead className="text-right">کد مشتری / طرف‌حساب</TableHead>
                    <TableHead className="text-center">انبار</TableHead>
                    <TableHead className="text-center">تاریخ سفارش</TableHead>
                    <TableHead className="text-center">وعده تحویل</TableHead>
                    <TableHead className="text-center">وضعیت</TableHead>
                    <TableHead className="text-left">مبلغ کل (ریال)</TableHead>
                    <TableHead className="text-center w-24">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        در حال بارگذاری سفارشات فروش...
                      </TableCell>
                    </TableRow>
                  ) : filteredOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        سفارش فروشی یافت نشد.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredOrders.map((o) => {
                      const st = ORDER_STATUS_MAP[o.status] ?? {
                        label: o.status,
                        variant: "secondary",
                      };
                      return (
                        <TableRow
                          key={o.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setSelectedOrder(o)}
                        >
                          <TableCell className="font-semibold text-primary">{o.number}</TableCell>
                          <TableCell className="font-medium">{o.partyCode}</TableCell>
                          <TableCell className="text-center text-xs text-muted-foreground">
                            انبار {o.warehouseId}
                          </TableCell>
                          <TableCell className="text-center text-xs tabular-nums">
                            {o.orderDate}
                          </TableCell>
                          <TableCell className="text-center text-xs tabular-nums text-muted-foreground">
                            {o.promisedDate || "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={st.variant} className="text-[10px]">
                              {st.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-left font-bold tabular-nums text-primary">
                            {formatSalesMoney(o.totalAmount)}
                          </TableCell>
                          <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedOrder(o)}
                              className="h-8 text-xs"
                            >
                              مشاهده
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* TAB 2: QUOTATIONS */}
          {activeTab === "quotations" && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">شماره پیش‌فاکتور</TableHead>
                    <TableHead className="text-right">کد مشتری / طرف‌حساب</TableHead>
                    <TableHead className="text-center">تاریخ</TableHead>
                    <TableHead className="text-center">مهلت اعتبار</TableHead>
                    <TableHead className="text-center">وضعیت</TableHead>
                    <TableHead className="text-left">مبلغ کل (ریال)</TableHead>
                    <TableHead className="text-center w-24">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        در حال بارگذاری پیش‌فاکتورها...
                      </TableCell>
                    </TableRow>
                  ) : filteredQuotations.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        پیش‌فاکتوری یافت نشد.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredQuotations.map((q) => {
                      const st = QUOTATION_STATUS_MAP[q.status] ?? {
                        label: q.status,
                        variant: "secondary",
                      };
                      return (
                        <TableRow
                          key={q.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setSelectedQuotation(q)}
                        >
                          <TableCell className="font-semibold text-primary">{q.number}</TableCell>
                          <TableCell className="font-medium">{q.partyCode}</TableCell>
                          <TableCell className="text-center text-xs tabular-nums">
                            {q.quoteDate}
                          </TableCell>
                          <TableCell className="text-center text-xs tabular-nums text-muted-foreground">
                            {q.validUntil || "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={st.variant} className="text-[10px]">
                              {st.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-left font-bold tabular-nums text-primary">
                            {formatSalesMoney(q.totalAmount)}
                          </TableCell>
                          <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedQuotation(q)}
                              className="h-8 text-xs"
                            >
                              مشاهده
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* TAB 3: DELIVERIES */}
          {activeTab === "deliveries" && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">شماره حواله</TableHead>
                    <TableHead className="text-center">سفارش فروش متناظر</TableHead>
                    <TableHead className="text-right">کد مشتری</TableHead>
                    <TableHead className="text-center">انبار</TableHead>
                    <TableHead className="text-center">تاریخ تحویل</TableHead>
                    <TableHead className="text-left">بهای تمام‌شده (ریال)</TableHead>
                    <TableHead className="text-center">سند خروج انبار</TableHead>
                    <TableHead className="text-center">سند مالی</TableHead>
                    <TableHead className="text-center w-24">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                        در حال بارگذاری حواله‌های تحویل...
                      </TableCell>
                    </TableRow>
                  ) : filteredDeliveries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                        حواله تحویلی یافت نشد.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredDeliveries.map((d) => (
                      <TableRow
                        key={d.id}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => setSelectedDelivery(d)}
                      >
                        <TableCell className="font-semibold text-primary">{d.number}</TableCell>
                        <TableCell className="text-center text-xs font-medium">
                          سفارش #{d.orderId}
                        </TableCell>
                        <TableCell className="font-medium">{d.partyCode}</TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          انبار {d.warehouseId}
                        </TableCell>
                        <TableCell className="text-center text-xs tabular-nums">
                          {d.deliveryDate}
                        </TableCell>
                        <TableCell className="text-left font-bold tabular-nums text-primary">
                          {formatSalesMoney(d.totalCost)}
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {d.stockDocumentId ? `#${d.stockDocumentId}` : "—"}
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {d.journalEntryId ? `#${d.journalEntryId}` : "—"}
                        </TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedDelivery(d)}
                            className="h-8 text-xs"
                          >
                            مشاهده
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* TAB 4: PRICE TIERS */}
          {activeTab === "price-tiers" && (
            <div className="p-4 sm:p-6">
              <PriceTiersTab />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drawers */}
      <SalesOrderCreateDrawer
        open={isCreatingOrder}
        onClose={() => setIsCreatingOrder(false)}
        onSuccess={(created) => {
          setOrders([created, ...orders]);
          setSelectedOrder(created);
        }}
      />

      <SalesOrderDetailDrawer
        order={selectedOrder}
        open={!!selectedOrder}
        canApprove={canApprove}
        canCreate={canCreate}
        onClose={() => setSelectedOrder(null)}
        onUpdated={(updated) => {
          setOrders(orders.map((o) => (o.id === updated.id ? updated : o)));
          setSelectedOrder(updated);
        }}
        onCreateDelivery={(ord) => {
          setOrderForDelivery(ord);
        }}
      />

      <QuotationCreateDrawer
        open={isCreatingQuotation}
        onClose={() => setIsCreatingQuotation(false)}
        onSuccess={(created) => {
          setQuotations([created, ...quotations]);
          setSelectedQuotation(created);
        }}
      />

      <QuotationDetailDrawer
        quotation={selectedQuotation}
        open={!!selectedQuotation}
        onClose={() => setSelectedQuotation(null)}
        onQuotationUpdated={(updated) => {
          setQuotations(quotations.map((q) => (q.id === updated.id ? updated : q)));
          setSelectedQuotation(updated);
        }}
        onConvertedToOrder={(newOrder) => {
          setOrders([newOrder, ...orders]);
          setSelectedOrder(newOrder);
        }}
      />

      <DeliveryCreateDrawer
        order={orderForDelivery}
        open={!!orderForDelivery}
        onClose={() => setOrderForDelivery(null)}
        onSuccess={(created) => {
          setDeliveries([created, ...deliveries]);
          setSelectedDelivery(created);
          refresh();
        }}
      />

      <DeliveryDetailDrawer
        delivery={selectedDelivery}
        open={!!selectedDelivery}
        onClose={() => setSelectedDelivery(null)}
      />
    </div>
  );
}
