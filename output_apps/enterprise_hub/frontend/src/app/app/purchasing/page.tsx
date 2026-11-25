"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DollarSign,
  FileSpreadsheet,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
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
  listGoodsReceipts,
  listPurchaseOrders,
  listSupplierInvoices,
} from "@/lib/api/purchasing-client";
import { formatJalaliDate } from "@/lib/fa-format";
import { cn } from "@/lib/utils";

import { PurchasingStats } from "@/components/purchasing/purchasing-stats";
import { OrderCreateDrawer } from "@/components/purchasing/order-create-drawer";
import { OrderDetailDrawer } from "@/components/purchasing/order-detail-drawer";
import { ReceiptCreateDrawer } from "@/components/purchasing/receipt-create-drawer";
import { ReceiptDetailDrawer } from "@/components/purchasing/receipt-detail-drawer";
import { InvoiceCreateDrawer } from "@/components/purchasing/invoice-create-drawer";
import { InvoiceDetailDrawer } from "@/components/purchasing/invoice-detail-drawer";
import { LandedCostDrawer } from "@/components/purchasing/landed-cost-drawer";
import { SettingsPanel } from "@/components/purchasing/settings-panel";
import { formatMinorMoney, formatQuantity } from "@/components/purchasing/purchasing-format";

import type {
  GoodsReceipt,
  PurchaseOrder,
  PurchaseOrderStatus,
  SupplierInvoice,
} from "@/types/purchasing";

type PurchasingTab = "orders" | "receipts" | "invoices" | "settings";

const ORDER_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "پیش‌نویس", variant: "secondary" },
  APPROVED: { label: "تأییدشده", variant: "default" },
  PARTIALLY_RECEIVED: { label: "دریافت جزئی", variant: "outline" },
  FULLY_RECEIVED: { label: "دریافت کامل", variant: "default" },
  CLOSED: { label: "بسته شده", variant: "secondary" },
  CANCELLED: { label: "لغو شده", variant: "destructive" },
};

const ORDER_FILTER_PILLS: { status?: PurchaseOrderStatus; label: string }[] = [
  { label: "همه" },
  { status: "DRAFT", label: "پیش‌نویس" },
  { status: "APPROVED", label: "تأییدشده" },
  { status: "PARTIALLY_RECEIVED", label: "دریافت جزئی" },
  { status: "FULLY_RECEIVED", label: "دریافت کامل" },
  { status: "CLOSED", label: "بسته" },
  { status: "CANCELLED", label: "لغو‌شده" },
];

export default function PurchasingCyclePage() {
  const { can, loading: accessLoading } = useAccess();

  // Active tab state
  const [activeTab, setActiveTab] = useState<PurchasingTab>("orders");

  // Data states
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters & search
  const [search, setSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<PurchaseOrderStatus | undefined>(undefined);

  // Drawers state
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);

  const [orderForReceipt, setOrderForReceipt] = useState<PurchaseOrder | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<GoodsReceipt | null>(null);

  const [orderForInvoice, setOrderForInvoice] = useState<PurchaseOrder | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<SupplierInvoice | null>(null);

  const [receiptForLandedCost, setReceiptForLandedCost] = useState<GoodsReceipt | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Permissions
  const canRead = can("inventory", "read");
  const canCreate = can("inventory", "create");
  const canApprove = can("inventory", "approve");
  const canPost = can("inventory", "post");
  const canAdmin = can("inventory", "admin");

  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    Promise.all([
      listPurchaseOrders(undefined, controller.signal),
      listGoodsReceipts(undefined, controller.signal),
      listSupplierInvoices(controller.signal),
    ])
      .then(([ordersData, receiptsData, invoicesData]) => {
        setOrders(ordersData);
        setReceipts(receiptsData);
        setInvoices(invoicesData);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "خطا در بارگذاری اطلاعات چرخه خرید.");
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
          o.supplierCode.toLowerCase().includes(q) ||
          o.lines.some((l) => l.sku.toLowerCase().includes(q))
      );
    }
    return result;
  }, [orders, orderStatusFilter, search]);

  // Filtered receipts
  const filteredReceipts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return receipts;
    return receipts.filter(
      (r) =>
        r.number.toLowerCase().includes(q) ||
        r.supplierCode.toLowerCase().includes(q) ||
        r.lines.some((l) => l.sku.toLowerCase().includes(q))
    );
  }, [receipts, search]);

  // Filtered invoices
  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(
      (inv) =>
        inv.number.toLowerCase().includes(q) ||
        inv.supplierCode.toLowerCase().includes(q) ||
        inv.supplierRef.toLowerCase().includes(q)
    );
  }, [invoices, search]);

  // Stats calculation
  const approvedOrdersCount = useMemo(
    () => orders.filter((o) => o.status === "APPROVED" || o.status === "PARTIALLY_RECEIVED").length,
    [orders]
  );

  // Access guard
  if (!accessLoading && !canRead) {
    return (
      <div className="p-6">
        <p
          role="alert"
          className="rounded-xl border border-border p-4 text-sm text-muted-foreground bg-muted/20"
          data-testid="no-access"
        >
          شما به ماژول انبار و چرخه خرید دسترسی ندارید. لطفاً با مدیر سیستم تماس بگیرید.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="purchasing-cycle-page">
      <PageHeader
        title="چرخه خرید و تدارکات"
        description="سفارش‌های خرید، رسید انبار، تطبیق ۳-طرفه صورتحساب و تخصیص هزینه‌های سربار خرید"
        icon={<ShoppingBag className="size-6 text-indigo-600" />}
        actions={
          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={loading}
              className="gap-1.5"
              aria-label="به‌روزرسانی داده‌ها"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              به‌روزرسانی
            </Button>
            {canCreate && (
              <Button
                size="sm"
                onClick={() => setIsCreatingOrder(true)}
                className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Plus className="size-4" />
                ثبت سفارش خرید جدید
              </Button>
            )}
          </div>
        }
      />

      {error && <ErrorNotice title="خطا در ارتباط با سرور" message={error} />}

      {/* Summary KPI Cards */}
      <PurchasingStats
        orderCount={orders.length}
        approvedCount={approvedOrdersCount}
        receiptCount={receipts.length}
        invoiceCount={invoices.length}
      />

      {/* Tabs list */}
      <div
        role="tablist"
        aria-label="بخش‌های چرخه خرید"
        className="flex flex-wrap items-center gap-2 border-b border-border pb-2"
      >
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === "orders"}
          onClick={() => setActiveTab("orders")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            activeTab === "orders"
              ? "bg-indigo-600 text-white shadow-xs"
              : "bg-muted/40 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          )}
        >
          <ShoppingBag className="size-4" />
          <span>سفارش‌های خرید ({orders.length.toLocaleString("fa-IR")})</span>
        </button>

        <button
          role="tab"
          type="button"
          aria-selected={activeTab === "receipts"}
          onClick={() => setActiveTab("receipts")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            activeTab === "receipts"
              ? "bg-indigo-600 text-white shadow-xs"
              : "bg-muted/40 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          )}
        >
          <Truck className="size-4" />
          <span>رسیدهای انبار ({receipts.length.toLocaleString("fa-IR")})</span>
        </button>

        <button
          role="tab"
          type="button"
          aria-selected={activeTab === "invoices"}
          onClick={() => setActiveTab("invoices")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            activeTab === "invoices"
              ? "bg-indigo-600 text-white shadow-xs"
              : "bg-muted/40 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          )}
        >
          <FileSpreadsheet className="size-4" />
          <span>صورتحساب‌های خرید ({invoices.length.toLocaleString("fa-IR")})</span>
        </button>

        <button
          role="tab"
          type="button"
          aria-selected={activeTab === "settings"}
          onClick={() => setActiveTab("settings")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            activeTab === "settings"
              ? "bg-indigo-600 text-white shadow-xs"
              : "bg-muted/40 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          )}
        >
          <Settings className="size-4" />
          <span>تنظیمات تحمل</span>
        </button>
      </div>

      {/* Tab: Orders */}
      {activeTab === "orders" && (
        <div className="flex flex-col gap-4">
          {/* Filter Bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full max-w-sm">
              <Search className="absolute right-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="جستجو در سفارش‌ها (شماره، تأمین‌کننده، کد کالا)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9 text-xs"
                aria-label="جستجوی سفارش‌های خرید"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="فیلتر وضعیت سفارش">
              {ORDER_FILTER_PILLS.map((p) => {
                const isSelected = orderStatusFilter === p.status;
                return (
                  <Button
                    key={p.label}
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                    onClick={() => setOrderStatusFilter(p.status)}
                    className="text-xs h-8"
                  >
                    {p.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <LoadingLine show={loading} />

          {filteredOrders.length === 0 ? (
            <Card className="p-12 text-center">
              <div className="flex flex-col items-center gap-3">
                <ShoppingBag className="size-12 text-muted-foreground/50" />
                <h3 className="text-base font-semibold">هیچ سفارش خریدی یافت نشد</h3>
                <p className="text-xs text-muted-foreground max-w-sm">
                  هنوز سفارشی با این مشخصات ثبت نشده است یا با فیلتر فعلی همخوانی ندارد.
                </p>
                {canCreate && (
                  <Button
                    size="sm"
                    onClick={() => setIsCreatingOrder(true)}
                    className="mt-2 gap-1.5"
                  >
                    <Plus className="size-4" />
                    ثبت اولین سفارش خرید
                  </Button>
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">شماره سفارش</TableHead>
                      <TableHead className="text-right">کد تأمین‌کننده</TableHead>
                      <TableHead className="text-center">تاریخ سفارش</TableHead>
                      <TableHead className="text-center">تعداد اقلام</TableHead>
                      <TableHead className="text-left">مبلغ برآوردی (ریال)</TableHead>
                      <TableHead className="text-center">وضعیت</TableHead>
                      <TableHead className="w-24 text-center">عملیات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map((ord) => {
                      const st = ORDER_STATUS_MAP[ord.status] ?? {
                        label: ord.status,
                        variant: "secondary",
                      };
                      let ordTotalMinor = 0n;
                      for (const l of ord.lines) {
                        try {
                          ordTotalMinor += (BigInt(l.quantity) * BigInt(l.unitPrice)) / 100n;
                        } catch {
                          // ignore
                        }
                      }

                      return (
                        <TableRow
                          key={ord.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setSelectedOrder(ord)}
                        >
                          <TableCell className="font-semibold text-indigo-600">
                            {ord.number}
                          </TableCell>
                          <TableCell className="font-medium">{ord.supplierCode}</TableCell>
                          <TableCell className="text-center tabular-nums text-xs">
                            {ord.orderDate}
                          </TableCell>
                          <TableCell className="text-center tabular-nums">
                            {ord.lines.length.toLocaleString("fa-IR")}
                          </TableCell>
                          <TableCell className="text-left tabular-nums font-semibold">
                            {formatMinorMoney(ordTotalMinor.toString())}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={st.variant}>{st.label}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOrder(ord);
                              }}
                            >
                              جزئیات
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Tab: Receipts */}
      {activeTab === "receipts" && (
        <div className="flex flex-col gap-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute right-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="جستجو در رسیدهای انبار (شماره، تأمین‌کننده)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9 text-xs"
              aria-label="جستجوی رسیدهای انبار"
            />
          </div>

          <LoadingLine show={loading} />

          {filteredReceipts.length === 0 ? (
            <Card className="p-12 text-center">
              <div className="flex flex-col items-center gap-3">
                <Truck className="size-12 text-muted-foreground/50" />
                <h3 className="text-base font-semibold">هیچ رسید کالایی ثبت نشده است</h3>
                <p className="text-xs text-muted-foreground max-w-sm">
                  رسیدهای انبار پس از تأیید سفارش خرید و تحویل فیزیکی کالا ثبت می‌شوند.
                </p>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">شماره رسید انبار</TableHead>
                      <TableHead className="text-right">تأمین‌کننده</TableHead>
                      <TableHead className="text-center">تاریخ دریافت</TableHead>
                      <TableHead className="text-center">تعداد اقلام</TableHead>
                      <TableHead className="text-left">ارزش کل رسید (ریال)</TableHead>
                      <TableHead className="text-center">سند ورود انبار</TableHead>
                      <TableHead className="w-24 text-center">عملیات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReceipts.map((rcpt) => (
                      <TableRow
                        key={rcpt.id}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => setSelectedReceipt(rcpt)}
                      >
                        <TableCell className="font-semibold text-emerald-600">
                          {rcpt.number}
                        </TableCell>
                        <TableCell className="font-medium">{rcpt.supplierCode}</TableCell>
                        <TableCell className="text-center tabular-nums text-xs">
                          {formatJalaliDate(rcpt.receivedAt)}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {rcpt.lines.length.toLocaleString("fa-IR")}
                        </TableCell>
                        <TableCell className="text-left tabular-nums font-semibold text-emerald-700">
                          {formatMinorMoney(rcpt.totalValue)}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          {rcpt.journalEntryId ? (
                            <Badge variant="outline" className="text-indigo-600 border-indigo-200">
                              ثبت‌شده
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedReceipt(rcpt);
                            }}
                          >
                            جزئیات
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Tab: Invoices */}
      {activeTab === "invoices" && (
        <div className="flex flex-col gap-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute right-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="جستجو در صورتحساب‌ها (شماره، فاکتور فروشنده، تأمین‌کننده)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9 text-xs"
              aria-label="جستجوی صورتحساب‌های خرید"
            />
          </div>

          <LoadingLine show={loading} />

          {filteredInvoices.length === 0 ? (
            <Card className="p-12 text-center">
              <div className="flex flex-col items-center gap-3">
                <FileSpreadsheet className="size-12 text-muted-foreground/50" />
                <h3 className="text-base font-semibold">هیچ صورتحساب خریدی یافت نشد</h3>
                <p className="text-xs text-muted-foreground max-w-sm">
                  پس از رسید کالا می‌توانید فاکتور خرید را ثبت و تطبیق ۳-طرفه انجام دهید.
                </p>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">شماره صورتحساب</TableHead>
                      <TableHead className="text-right">فاکتور فروشنده</TableHead>
                      <TableHead className="text-right">تأمین‌کننده</TableHead>
                      <TableHead className="text-center">تاریخ</TableHead>
                      <TableHead className="text-left">مبلغ کل (ریال)</TableHead>
                      <TableHead className="text-center">وضعیت تطبیق</TableHead>
                      <TableHead className="w-24 text-center">عملیات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.map((inv) => {
                      const isHeld = inv.status === "HELD";
                      const isMatched = inv.status === "MATCHED";
                      const isPosted = inv.status === "POSTED";

                      return (
                        <TableRow
                          key={inv.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setSelectedInvoice(inv)}
                        >
                          <TableCell className="font-semibold text-purple-600">
                            {inv.number}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{inv.supplierRef}</TableCell>
                          <TableCell className="font-medium">{inv.supplierCode}</TableCell>
                          <TableCell className="text-center tabular-nums text-xs">
                            {inv.invoiceDate}
                          </TableCell>
                          <TableCell className="text-left tabular-nums font-semibold">
                            {formatMinorMoney(inv.total)}
                          </TableCell>
                          <TableCell className="text-center">
                            {isHeld && <Badge variant="destructive">معلق (اختلاف)</Badge>}
                            {isMatched && <Badge variant="outline" className="text-emerald-700 border-emerald-300">تطبیق‌یافته</Badge>}
                            {isPosted && <Badge variant="default" className="bg-emerald-600">سند ثبت‌شده</Badge>}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedInvoice(inv);
                              }}
                            >
                              جزئیات
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Tab: Settings */}
      {activeTab === "settings" && <SettingsPanel canAdmin={canAdmin} />}

      {/* Drawers */}
      <OrderCreateDrawer
        open={isCreatingOrder}
        onClose={() => setIsCreatingOrder(false)}
        onSuccess={(created) => {
          setOrders((prev) => [created, ...prev]);
          setSelectedOrder(created);
        }}
      />

      <OrderDetailDrawer
        order={selectedOrder}
        open={!!selectedOrder}
        canApprove={canApprove}
        canPost={canPost}
        onClose={() => setSelectedOrder(null)}
        onUpdated={(updated) => {
          setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
          setSelectedOrder(updated);
        }}
        onCreateReceipt={(ord) => setOrderForReceipt(ord)}
        onCreateInvoice={(ord) => setOrderForInvoice(ord)}
      />

      <ReceiptCreateDrawer
        order={orderForReceipt}
        open={!!orderForReceipt}
        onClose={() => setOrderForReceipt(null)}
        onSuccess={(created) => {
          setReceipts((prev) => [created, ...prev]);
          setSelectedReceipt(created);
          refresh();
        }}
      />

      <ReceiptDetailDrawer
        receipt={selectedReceipt}
        open={!!selectedReceipt}
        canPost={canPost}
        onClose={() => setSelectedReceipt(null)}
        onOpenLandedCost={(rcpt) => setReceiptForLandedCost(rcpt)}
      />

      <LandedCostDrawer
        receipt={receiptForLandedCost}
        open={!!receiptForLandedCost}
        onClose={() => setReceiptForLandedCost(null)}
        onSuccess={() => {
          refresh();
        }}
      />

      <InvoiceCreateDrawer
        order={orderForInvoice}
        open={!!orderForInvoice}
        onClose={() => setOrderForInvoice(null)}
        onSuccess={(created) => {
          setInvoices((prev) => [created, ...prev]);
          setSelectedInvoice(created);
          refresh();
        }}
      />

      <InvoiceDetailDrawer
        invoice={selectedInvoice}
        open={!!selectedInvoice}
        canApprove={canApprove}
        canPost={canPost}
        onClose={() => setSelectedInvoice(null)}
        onUpdated={(updated) => {
          setInvoices((prev) => prev.map((inv) => (inv.id === updated.id ? updated : inv)));
          setSelectedInvoice(updated);
        }}
      />
    </div>
  );
}
