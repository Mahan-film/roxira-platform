"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Printer,
  RefreshCw,
  ShoppingBag,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";

import { PageHeader } from "@/components/app/app-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPosSale } from "@/lib/api/invoicing-client";
import { listWarehouses } from "@/lib/api/inventory-client";
import { formatMoneyRial } from "@/lib/fa-format";
import { printPosReceipt } from "@/lib/print/open-pos-receipt-window";
import {
  clearSyncedSales,
  getQueuedSales,
  queueOfflineSale,
  removeQueuedSale,
  type QueuedPosSale,
} from "@/lib/pos-offline-db";
import { syncOfflineSalesQueue } from "@/lib/pos-sync-manager";
import type { Warehouse } from "@/types/inventory";
import {
  PAYMENT_METHOD_LABELS,
  VAT_RATE,
  type CreatePosSaleDto,
  type PaymentMethod,
  type PosSaleResponse,
} from "@/types/invoicing";

interface PosLineState {
  uid: number;
  code: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

export default function PosCounterPage() {
  const nextUid = useRef(2);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [lines, setLines] = useState<PosLineState[]>([
    { uid: 1, code: "", description: "", quantity: "1", unitPrice: "" },
  ]);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [cardAmount, setCardAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [queuedSales, setQueuedSales] = useState<QueuedPosSale[]>([]);

  // Monitor network online/offline transitions
  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);

    const handleOnline = () => {
      setIsOnline(true);
      setNotice({ type: "info", message: "اتصال به اینترنت برقرار شد. در حال همگام‌سازی فروش‌های صف..." });
      void handleSync();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setNotice({ type: "info", message: "ارتباط با اینترنت قطع شد؛ سیستم به حالت فروش آفلاین تغییر وضعیت داد." });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Load warehouses and offline queue on mount
  useEffect(() => {
    const controller = new AbortController();
    listWarehouses(controller.signal)
      .then((list) => setWarehouses(list.filter((w) => w.isActive)))
      .catch(() => undefined);

    void refreshQueue();
    return () => controller.abort();
  }, []);

  async function refreshQueue() {
    const list = await getQueuedSales();
    setQueuedSales(list);
  }

  function updateLine(uid: number, patch: Partial<PosLineState>) {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { uid: nextUid.current++, code: "", description: "", quantity: "1", unitPrice: "" },
    ]);
  }

  function removeLine(uid: number) {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.uid !== uid));
  }

  const validLines = lines.filter(
    (l) => (l.code.trim() || l.description.trim()) && Number(l.quantity) > 0 && Number(l.unitPrice) > 0,
  );
  const netTotal = validLines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);
  const estimatedPayable = Math.round(netTotal * (1 + VAT_RATE));

  function resetForm() {
    setPhone("");
    setName("");
    setLines([{ uid: nextUid.current++, code: "", description: "", quantity: "1", unitPrice: "" }]);
    setCardAmount("");
    setMethod("CASH");
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await syncOfflineSalesQueue();
      await refreshQueue();
      if (res.syncedCount > 0) {
        setNotice({
          type: "success",
          message: `${res.syncedCount} فروش آفلاین با موفقیت در سرور همگام‌سازی شد.`,
        });
      }
      if (res.conflictCount > 0) {
        setNotice({
          type: "error",
          message: `${res.conflictCount} فروش به‌دلیل کسری موجودی کالا در انبار با مغایرت مواجه شد. لطفاً جدول مغایرت‌ها را بررسی فرمایید.`,
        });
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (validLines.length === 0) {
      setNotice({ type: "error", message: "حداقل یک سطر با کد یا شرح، تعداد و قیمت وارد کنید." });
      return;
    }

    const card = Number(cardAmount) || 0;
    if (card < 0 || card > estimatedPayable) {
      setNotice({ type: "error", message: "مبلغ پرداختی کارتخوان نامعتبر است." });
      return;
    }

    const payments =
      card > 0 && card < estimatedPayable
        ? [
            { method: "CARD" as PaymentMethod, amount: card },
            { method, amount: estimatedPayable - card },
          ]
        : [{ method: card > 0 ? ("CARD" as PaymentMethod) : method, amount: estimatedPayable }];

    const clientUuid = `pos-${crypto.randomUUID()}`;
    const salePayload: CreatePosSaleDto = {
      idempotencyKey: clientUuid,
      customer:
        phone.trim() || name.trim()
          ? { phone: phone.trim() || undefined, name: name.trim() || undefined }
          : undefined,
      lines: validLines.map((l) => ({
        code: l.code.trim() || undefined,
        description: l.description.trim() || undefined,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
      })),
      payments,
      warehouseId: warehouseId ? Number(warehouseId) : undefined,
    };

    setBusy(true);
    setNotice(null);

    // If offline or if connection fails, queue in IndexedDB immediately
    if (!isOnline) {
      await queueOfflineSale(salePayload);
      await refreshQueue();
      setNotice({
        type: "info",
        message: `فروش با موفقیت در صف آفلاین ذخیره شد (شناسه: ${clientUuid.slice(0, 12)}). به محض اتصال به اینترنت همگام‌سازی خواهد شد.`,
      });
      resetForm();
      setBusy(false);
      return;
    }

    try {
      const result = await createPosSale(salePayload);
      setNotice({
        type: "success",
        message: `فروش با شماره ${result.invoice.taxInvoiceNumber} با موفقیت ثبت شد.`,
      });
      resetForm();
    } catch {
      // Network drop during live submission -> fall back safely to offline queue
      await queueOfflineSale(salePayload);
      await refreshQueue();
      setNotice({
        type: "info",
        message: `ارتباط با سرور برقرار نشد؛ فروش در صف آفلاین ذخیره شد و به محض اتصال مجدد ثبت خواهد شد.`,
      });
      resetForm();
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = queuedSales.filter((s) => s.status === "pending" || s.status === "syncing").length;
  const conflictSales = queuedSales.filter((s) => s.status === "conflict");

  return (
    <div className="space-y-6">
      <PageHeader
        title="پایانه فروشگاهی و صندوق (POS)"
        subtitle="فروش سریع پشت صندوق با قابلیت کارکرد کامل در زمان قطع اینترنت، ثبت در صف محلی و همگام‌سازی خودکار"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                isOnline
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
              }`}
            >
              {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              <span>{isOnline ? "آنلاین (متصل)" : "آفلاین (بدون اینترنت)"}</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={syncing || pendingCount === 0 || !isOnline}
              onClick={() => void handleSync()}
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              همگام‌سازی صف ({pendingCount})
            </Button>

            <Link href="/app/invoicing">
              <Button variant="ghost" size="sm">
                صورتحساب‌ها
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        }
      />

      {notice && (
        <div
          className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
            notice.type === "success"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
              : notice.type === "error"
                ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                : "bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/30"
          }`}
        >
          {notice.type === "success" && <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {notice.type === "error" && <AlertCircle className="h-4 w-4 shrink-0" />}
          {notice.type === "info" && <Clock className="h-4 w-4 shrink-0" />}
          <span>{notice.message}</span>
        </div>
      )}

      {/* Conflicts & Out of Stock Drawer / Banner */}
      {conflictSales.length > 0 && (
        <Card className="border-rose-500/40 bg-rose-500/5 p-4">
          <div className="flex items-center justify-between pb-3 border-b border-rose-500/20">
            <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 font-medium text-sm">
              <AlertCircle className="h-4 w-4" />
              لیست مغایرت‌ها و کالاهای کسری موجودی ({conflictSales.length} مورد)
            </div>
          </div>
          <div className="divide-y divide-rose-500/10 mt-2 text-sm">
            {conflictSales.map((item) => (
              <div key={item.clientUuid} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-mono text-xs text-muted-foreground">{item.clientUuid.slice(0, 16)}</span>
                  <p className="text-rose-600 dark:text-rose-400 text-xs mt-0.5">{item.error || "کسری موجودی کالا"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!isOnline || syncing}
                    onClick={() => void handleSync()}
                  >
                    تلاش مجدد
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-rose-600"
                    onClick={async () => {
                      await removeQueuedSale(item.clientUuid);
                      await refreshQueue();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    حذف
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Counter Sales Entry Form */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <h2 className="text-base font-semibold">ثبت فروش پایانه</h2>
                <span className="text-xs text-muted-foreground">مالیات بر ارزش افزوده ۱۰٪ به‌صورت خودکار محاسبه می‌شود</span>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="pos-phone">تلفن مشتری (اختیاری)</Label>
                  <Input
                    id="pos-phone"
                    dir="ltr"
                    inputMode="tel"
                    placeholder="0912..."
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="pos-name">نام مشتری (اختیاری)</Label>
                  <Input
                    id="pos-name"
                    placeholder="مشتری گذری"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="pos-warehouse">انبار تحویل کالا</Label>
                  <select
                    id="pos-warehouse"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                  >
                    <option value="">انبار پیش‌فرض</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">اقلام فروش</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addLine}>
                    افزودن سطر
                  </Button>
                </div>

                <div className="space-y-2">
                  {lines.map((l) => (
                    <div key={l.uid} className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm bg-muted/20">
                      <div className="w-28 shrink-0">
                        <Input
                          placeholder="کد / بارکد"
                          value={l.code}
                          onChange={(e) => updateLine(l.uid, { code: e.target.value })}
                        />
                      </div>
                      <div className="flex-1 min-w-[140px]">
                        <Input
                          placeholder="شرح کالا"
                          value={l.description}
                          onChange={(e) => updateLine(l.uid, { description: e.target.value })}
                        />
                      </div>
                      <div className="w-20 shrink-0">
                        <Input
                          type="number"
                          min="1"
                          placeholder="تعداد"
                          value={l.quantity}
                          onChange={(e) => updateLine(l.uid, { quantity: e.target.value })}
                        />
                      </div>
                      <div className="w-32 shrink-0">
                        <Input
                          type="number"
                          placeholder="قیمت واحد (ریال)"
                          value={l.unitPrice}
                          onChange={(e) => updateLine(l.uid, { unitPrice: e.target.value })}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={lines.length <= 1}
                        onClick={() => removeLine(l.uid)}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment Methods */}
              <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t">
                <div>
                  <Label htmlFor="pos-pay-method">روش پرداخت اصلی</Label>
                  <select
                    id="pos-pay-method"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  >
                    <option value="CASH">{PAYMENT_METHOD_LABELS.CASH}</option>
                    <option value="CARD">{PAYMENT_METHOD_LABELS.CARD}</option>
                    <option value="BANK_TRANSFER">{PAYMENT_METHOD_LABELS.BANK_TRANSFER}</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="pos-card-amount">مبلغ کارت‌خوان (در صورت پرداخت ترکیبی)</Label>
                  <Input
                    id="pos-card-amount"
                    type="number"
                    placeholder="اختیاری"
                    value={cardAmount}
                    onChange={(e) => setCardAmount(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t">
                <div className="text-sm">
                  <span className="text-muted-foreground">مبلغ کل برآوردی (با مالیات): </span>
                  <span className="font-semibold">{formatMoneyRial(estimatedPayable)}</span>
                </div>

                <Button type="submit" disabled={busy || validLines.length === 0}>
                  <ShoppingBag className="h-4 w-4" />
                  {isOnline ? "ثبت فروش آنلاین" : "ثبت در صف آفلاین"}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        {/* Queue & Activity Sidebar */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between pb-3 border-b">
              <h3 className="text-sm font-semibold">صف فروش‌های محلی</h3>
              {queuedSales.some((s) => s.status === "synced") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={async () => {
                    await clearSyncedSales();
                    await refreshQueue();
                  }}
                >
                  پاکسازی ارسال‌شده‌ها
                </Button>
              )}
            </div>

            <div className="divide-y text-xs mt-2 max-h-96 overflow-y-auto">
              {queuedSales.length === 0 ? (
                <p className="py-6 text-center text-muted-foreground">صف فروش‌های آفلاین خالی است.</p>
              ) : (
                queuedSales.map((item) => (
                  <div key={item.clientUuid} className="py-2.5 flex items-center justify-between">
                    <div>
                      <p className="font-mono text-xs">{item.clientUuid.slice(0, 16)}</p>
                      <span className="text-muted-foreground">
                        {item.sale.lines.length} قلم کالا • {item.createdAt.slice(11, 19)}
                      </span>
                    </div>
                    <div>
                      {item.status === "pending" && (
                        <span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-600 font-medium">در صف</span>
                      )}
                      {item.status === "syncing" && (
                        <span className="rounded bg-sky-500/10 px-2 py-0.5 text-sky-600 font-medium">ارسال...</span>
                      )}
                      {item.status === "synced" && (
                        <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-emerald-600 font-medium">ارسال شد</span>
                      )}
                      {item.status === "conflict" && (
                        <span className="rounded bg-rose-500/10 px-2 py-0.5 text-rose-600 font-medium">مغایرت انبار</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
