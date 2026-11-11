"use client";

import { useEffect, useState } from "react";
import {
  Boxes,
  Factory,
  Layers,
  Play,
  CheckCircle,
  XCircle,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/app-ui";
import { formatNumber } from "@/lib/fa-format";

interface BomItem {
  id?: number;
  componentSku: string;
  subBomId?: number | null;
  quantity: number;
  wastePercent: number;
  notes?: string;
}

interface BomHeader {
  id: number;
  bomCode: string;
  name: string;
  finishedItemSku: string;
  outputQuantity: number;
  version: number;
  isActive: boolean;
  notes: string | null;
  items?: BomItem[];
  createdAt: string;
}

interface ProductionOrder {
  id: number;
  orderNumber: string;
  bomId: number;
  finishedSku: string;
  plannedQuantity: number;
  completedQuantity: number;
  status: "draft" | "in_progress" | "completed" | "cancelled";
  totalCostMinor: string;
  unitCostMinor: string;
  notes: string | null;
  createdAt: string;
}

export default function ProductionBomPage() {
  const [activeTab, setActiveTab] = useState<"boms" | "orders">("boms");
  const [boms, setBoms] = useState<BomHeader[]>([]);
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const statusLabels: Record<string, { label: string; color: string }> = {
    draft: { label: "پیش‌نویس", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    in_progress: { label: "در حال تولید", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
    completed: { label: "تکمیل‌شده", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
    cancelled: { label: "لغو شده", color: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
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
          </div>
        }
      />

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
      {activeTab === "boms" ? (
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
                  <th className="p-3">بهای کل (ریال)</th>
                  <th className="p-3">بهای واحد (ریال)</th>
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
                          {order.totalCostMinor !== "0" ? formatNumber(order.totalCostMinor) : "—"}
                        </td>
                        <td className="p-3 font-mono">
                          {order.unitCostMinor !== "0" ? formatNumber(order.unitCostMinor) : "—"}
                        </td>
                        <td className="p-3 text-left">
                          {order.status === "draft" && (
                            <Button size="sm" variant="outline">
                              <Play className="ml-1 h-3 w-3 text-amber-600" />
                              شروع تولید
                            </Button>
                          )}
                          {order.status === "in_progress" && (
                            <Button size="sm" variant="outline">
                              <CheckCircle className="ml-1 h-3 w-3 text-emerald-600" />
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
