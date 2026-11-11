"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  Factory,
  Layers,
  Play,
  CheckCircle,
  Plus,
  RefreshCw,
  Search,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/app-ui";
import { formatNumber, formatMoneyRial } from "@/lib/fa-format";
import {
  BomHeaderResponse,
  ProductionOrderResponse,
  listBoms,
  listProductionOrders,
  startProductionOrder,
  completeProductionOrder,
} from "@/lib/api/inventory-client";

export default function ProductionBomPage() {
  const [activeTab, setActiveTab] = useState<"boms" | "orders">("boms");
  const [boms, setBoms] = useState<BomHeaderResponse[]>([]);
  const [orders, setOrders] = useState<ProductionOrderResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const statusLabels: Record<string, { label: string; color: string }> = {
    draft: { label: "پیش‌نویس", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    in_progress: { label: "در حال تولید", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
    completed: { label: "تکمیل‌شده", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
    cancelled: { label: "لغو شده", color: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === "boms") {
        const data = await listBoms();
        setBoms(data ?? []);
      } else {
        const data = await listProductionOrders();
        setOrders(data ?? []);
      }
    } catch (err: any) {
      setError(err?.message ?? "خطا در دریافت اطلاعات از سرور");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleStartOrder = async (orderId: number) => {
    setActionLoadingId(orderId);
    setError(null);
    try {
      await startProductionOrder(orderId);
      await loadData();
    } catch (err: any) {
      setError(err?.message ?? "خطا در شروع سفارش تولید");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCompleteOrder = async (order: ProductionOrderResponse) => {
    setActionLoadingId(order.id);
    setError(null);
    try {
      await completeProductionOrder(order.id, {
        completedQuantity: order.plannedQuantity,
      });
      await loadData();
    } catch (err: any) {
      setError(err?.message ?? "خطا در تکمیل سفارش تولید و صدور سند");
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredBoms = boms.filter(
    (b) =>
      b.bomCode.toLowerCase().includes(search.toLowerCase()) ||
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.finishedItemSku.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredOrders = orders.filter(
    (o) =>
      o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
      o.finishedSku.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="فرمول ساخت و سفارشات تولید (BOM)"
        description="مدیریت فرمول‌های ساخت چندسطحی با درصد ضایعات و صدور سفارشات تولید با بهای تمام‌شده FIFO"
        icon={<Factory className="h-6 w-6 text-primary" />}
        action={
          <div className="flex gap-2">
            <Button
              variant={activeTab === "boms" ? "default" : "outline"}
              onClick={() => setActiveTab("boms")}
              size="sm"
            >
              <Layers className="ml-2 h-4 w-4" />
              فرمول‌های ساخت (BOM)
            </Button>
            <Button
              variant={activeTab === "orders" ? "default" : "outline"}
              onClick={() => setActiveTab("orders")}
              size="sm"
            >
              <Boxes className="ml-2 h-4 w-4" />
              سفارشات تولید
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={loadData}
              disabled={loading}
              title="بارگذاری مجدد"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Controls Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="جستجو در کد، نام، کالا..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
        <div className="flex gap-2">
          {activeTab === "boms" ? (
            <Button size="sm">
              <Plus className="ml-2 h-4 w-4" />
              فرمول ساخت جدید
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="ml-2 h-4 w-4" />
              سفارش تولید جدید
            </Button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {loading && boms.length === 0 && orders.length === 0 ? (
        <div className="flex items-center justify-center p-12 text-muted-foreground">
          <Loader2 className="ml-2 h-5 w-5 animate-spin" />
          <span>در حال بارگذاری اطلاعات...</span>
        </div>
      ) : activeTab === "boms" ? (
        <div className="rounded-lg border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="p-3">کد فرمول</th>
                  <th className="p-3">عنوان فرمول ساخت</th>
                  <th className="p-3">کالای ساخته‌شده</th>
                  <th className="p-3">مقدار خروجی</th>
                  <th className="p-3">ویرایش</th>
                  <th className="p-3">تعداد اجزاء</th>
                  <th className="p-3">وضعیت</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredBoms.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      فرمول ساختی یافت نشد. برای تعریف اولین فرمول ساخت روی «فرمول ساخت جدید» کلیک کنید.
                    </td>
                  </tr>
                ) : (
                  filteredBoms.map((bom) => (
                    <tr key={bom.id} className="hover:bg-muted/30">
                      <td className="p-3 font-mono font-medium">{bom.bomCode}</td>
                      <td className="p-3">{bom.name}</td>
                      <td className="p-3 font-mono">{bom.finishedItemSku}</td>
                      <td className="p-3">{formatNumber(bom.outputQuantity)}</td>
                      <td className="p-3 font-mono">{bom.version}</td>
                      <td className="p-3">{formatNumber(bom.items?.length ?? 0)}</td>
                      <td className="p-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            bom.isActive
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {bom.isActive ? "فعال" : "غیرفعال"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="p-3">شماره سفارش</th>
                  <th className="p-3">کالای تولیدی</th>
                  <th className="p-3">مقدار برنامه‌ریزی</th>
                  <th className="p-3">مقدار تولیدشده</th>
                  <th className="p-3">وضعیت</th>
                  <th className="p-3">بهای کل</th>
                  <th className="p-3">بهای واحد</th>
                  <th className="p-3 text-left">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      سفارش تولیدی ثبت نشده است. برای صدور اولین دستور تولید روی «سفارش تولید جدید» کلیک کنید.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order) => {
                    const status = statusLabels[order.status] ?? {
                      label: order.status,
                      color: "bg-slate-100 text-slate-700",
                    };
                    const isActionBusy = actionLoadingId === order.id;

                    return (
                      <tr key={order.id} className="hover:bg-muted/30">
                        <td className="p-3 font-mono font-medium">{order.orderNumber}</td>
                        <td className="p-3 font-mono">{order.finishedSku}</td>
                        <td className="p-3">{formatNumber(order.plannedQuantity)}</td>
                        <td className="p-3">{formatNumber(order.completedQuantity)}</td>
                        <td className="p-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="p-3 font-mono">
                          {order.totalCostMinor !== "0" && order.totalCostMinor ? (
                            formatMoneyRial(order.totalCostMinor)
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-3 font-mono">
                          {order.unitCostMinor !== "0" && order.unitCostMinor ? (
                            formatMoneyRial(order.unitCostMinor)
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-3 text-left">
                          {order.status === "draft" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleStartOrder(order.id)}
                              disabled={isActionBusy}
                            >
                              {isActionBusy ? (
                                <Loader2 className="ml-1 h-3 w-3 animate-spin" />
                              ) : (
                                <Play className="ml-1 h-3 w-3 text-amber-600" />
                              )}
                              شروع تولید
                            </Button>
                          )}
                          {order.status === "in_progress" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCompleteOrder(order)}
                              disabled={isActionBusy}
                            >
                              {isActionBusy ? (
                                <Loader2 className="ml-1 h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle className="ml-1 h-3 w-3 text-emerald-600" />
                              )}
                              تکمیل تولید
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
