"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
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
import { useAccess } from "@/components/app/access-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiClientError } from "@/lib/api/http-client";
import { createPosSale } from "@/lib/api/invoicing-client";
import { listWarehouses } from "@/lib/api/inventory-client";
import { getMyTenant } from "@/lib/api/tenants-client";
import { formatMoneyRial } from "@/lib/fa-format";
import {
  bigintToSafeJsonNumber,
  computePosCartTotals,
  normaliseNumericInput,
  parsePosQuantity,
  parsePosUnitPrice,
  splitPosPayment,
  toFaDigits,
} from "@/lib/pos-money";
import { printPosReceipt } from "@/lib/print/open-pos-receipt-window";
import {
  clearSyncedSales,
  getCachedTenantVatRate,
  getQueuedSales,
  queueOfflineSale,
  removeQueuedSale,
  retryQueuedSale,
  setCachedTenantVatRate,
  setUnsyncedOfflineSalesCount,
  type QueuedPosSale,
} from "@/lib/pos-offline-db";
import { syncOfflineSalesQueue } from "@/lib/pos-sync-manager";
import type { Warehouse } from "@/types/inventory";
import {
  PAYMENT_METHOD_LABELS,
  type CreatePosSaleDto,
  type InvoiceResponseDto,
  type PaymentMethod,
  type PosConflict,
} from "@/types/invoicing";

interface PosLineState {
  uid: number;
  code: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

const CONFLICT_BADGE_LABELS: Record<PosConflict["code"], string> = {
  OUT_OF_STOCK: "کسری موجودی",
  ITEM_NOT_FOUND: "کالا یافت نشد",
  VALIDATION_FAILED: "خطای اعتبارسنجی",
  CONFLICT: "تداخل شناسه",
  UNKNOWN: "مغایرت / خطا",
};

function isOfflineOrTransientError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return true;
  }
  if (err instanceof ApiClientError) {
    return err.statusCode >= 500 || err.statusCode === 408 || err.statusCode === 429;
  }
  // Only fall back to the offline queue on network/fetch failures (TypeError), not arbitrary bugs.
  return err instanceof TypeError;
}

function generateClientUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error("مرورگر امکان تولید شناسه یکتا را ندارد.");
}

const subscribeOnlineStatus = (onStoreChange: () => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
};

const getOnlineSnapshot = () => (typeof navigator !== "undefined" ? navigator.onLine : true);
const getOnlineServerSnapshot = () => true;

export default function PosCounterPage() {
  const { org, loading: accessLoading, can } = useAccess();
  const tenantId = org?.tenantId ?? "";
  const canRead = can("invoicing", "read");
  const canCreate = can("invoicing", "create");

  const nextUid = useRef(2);
  const isOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineSnapshot,
    getOnlineServerSnapshot,
  );
  const [vatRateState, setVatRateState] = useState<{ tenantId: string; rate: number | null }>({
    tenantId: "",
    rate: null,
  });
  const vatRate =
    vatRateState.tenantId === tenantId && vatRateState.rate !== null
      ? vatRateState.rate
      : tenantId
        ? getCachedTenantVatRate(tenantId)
        : null;
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
  const [queuedSalesState, setQueuedSalesState] = useState<{ tenantId: string; items: QueuedPosSale[] }>({
    tenantId: "",
    items: [],
  });
  const [lastInvoice, setLastInvoice] = useState<InvoiceResponseDto | null>(null);
  const queuedSales = tenantId && canRead && queuedSalesState.tenantId === tenantId ? queuedSalesState.items : [];

  const refreshQueue = useCallback(async (activeTenantId = tenantId) => {
    if (!activeTenantId) return;
    const list = await getQueuedSales(activeTenantId);
    setUnsyncedOfflineSalesCount(
      activeTenantId,
      list.filter((item) => item.status !== "synced").length,
    );
    setQueuedSalesState({ tenantId: activeTenantId, items: list });
  }, [tenantId]);

  const handleSync = useCallback(async (targetClientUuid?: string) => {
    if (!tenantId || !canCreate) return;
    setSyncing(true);
    try {
      if (targetClientUuid) {
        await retryQueuedSale(targetClientUuid, tenantId);
      }
      const res = await syncOfflineSalesQueue(tenantId);
      await refreshQueue(tenantId);
      const updated = await getQueuedSales(tenantId);
      const latestSynced = updated.find((item) => item.status === "synced" && item.invoice);
      if (latestSynced?.invoice) {
        setLastInvoice((prev) => prev ?? latestSynced.invoice!);
      }

      if (res.errors && res.errors.length > 0 && res.syncedCount === 0 && res.conflictCount === 0) {
        setNotice({ type: "error", message: res.errors.join(" | ") });
      } else if (res.conflictCount > 0) {
        setNotice({
          type: "error",
          message:
            res.syncedCount > 0
              ? `${res.syncedCount} فروش همگام‌سازی شد و ${res.conflictCount} مورد با مغایرت مواجه شد. جدول مغایرت‌ها را بررسی کنید.`
              : `${res.conflictCount} فروش هنگام همگام‌سازی با خطا یا مغایرت مواجه شد. جدول مغایرت‌ها را بررسی فرمایید.`,
        });
      } else if (res.syncedCount > 0) {
        setNotice({
          type: "success",
          message: `${res.syncedCount} فروش آفلاین با موفقیت در سرور همگام‌سازی شد.`,
        });
      }
    } finally {
      setSyncing(false);
    }
  }, [tenantId, canCreate, refreshQueue]);

  // Trigger sync and status notices on online/offline browser transitions
  useEffect(() => {
    const handleOnline = () => {
      if (tenantId && canCreate) {
        setNotice({ type: "info", message: "اتصال به اینترنت برقرار شد. در حال همگام‌سازی فروش‌های صف..." });
        void handleSync();
      }
    };

    const handleOffline = () => {
      setNotice({ type: "info", message: "ارتباط با اینترنت قطع شد؛ سیستم به حالت فروش آفلاین تغییر وضعیت داد." });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [tenantId, canCreate, handleSync]);

  // Load warehouses, tenant VAT rate, and tenant-scoped offline queue on mount / org change
  useEffect(() => {
    if (!tenantId || !canRead) return;

    const controller = new AbortController();
    listWarehouses(controller.signal)
      .then((list) => setWarehouses(list.filter((w) => w.isActive)))
      .catch(() => undefined);

    getMyTenant(controller.signal)
      .then((tenant) => {
        if (typeof tenant.defaultVatRate === "number" && Number.isFinite(tenant.defaultVatRate)) {
          setCachedTenantVatRate(tenantId, tenant.defaultVatRate);
          setVatRateState({ tenantId, rate: tenant.defaultVatRate });
        }
      })
      .catch(() => undefined);

    void getQueuedSales(tenantId).then((items) => {
      if (!controller.signal.aborted) {
        setUnsyncedOfflineSalesCount(
          tenantId,
          items.filter((item) => item.status !== "synced").length,
        );
        setQueuedSalesState({ tenantId, items });
      }
    });
    return () => controller.abort();
  }, [tenantId, canRead]);

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

  const validLines = lines.filter((l) => {
    if (!l.code.trim() && !l.description.trim()) return false;
    const qty = parsePosQuantity(l.quantity);
    const price = parsePosUnitPrice(l.unitPrice);
    return qty !== null && price !== null;
  });
  const cartTotals = computePosCartTotals(validLines, vatRate ?? 0);
  const estimatedPayableNumber = bigintToSafeJsonNumber(cartTotals.payableTotal);
  const hasExceededSafeBounds =
    cartTotals.payableTotal > BigInt(Number.MAX_SAFE_INTEGER) ||
    lines.some((l) => {
      const trimmedPrice = normaliseNumericInput(l.unitPrice);
      return trimmedPrice !== "" && parsePosUnitPrice(l.unitPrice) === null;
    });

  function resetForm() {
    setPhone("");
    setName("");
    setLines([{ uid: nextUid.current++, code: "", description: "", quantity: "1", unitPrice: "" }]);
    setCardAmount("");
    setMethod("CASH");
  }

  function editConflictedSale(item: QueuedPosSale) {
    if (lines.some((l) => l.code.trim() || l.description.trim())) {
      if (
        typeof window !== "undefined" &&
        !window.confirm("اقلام موجود در سبد خرید با اقلام این فروش جایگزین خواهند شد. ادامه می‌دهید؟")
      ) {
        return;
      }
    }
    setPhone(item.sale.customer?.phone ?? "");
    setName(item.sale.customer?.name ?? "");
    const loadedLines = item.sale.lines.map((l: { code?: string; description?: string; quantity: number; unitPrice: number }) => ({
      uid: nextUid.current++,
      code: l.code ?? "",
      description: l.description ?? "",
      quantity: String(l.quantity),
      unitPrice: String(l.unitPrice),
    }));
    setLines(
      loadedLines.length > 0
        ? loadedLines
        : [{ uid: nextUid.current++, code: "", description: "", quantity: "1", unitPrice: "" }],
    );
    const cardPay = item.sale.payments.find((p: { method: PaymentMethod; amount: number }) => p.method === "CARD");
    setCardAmount(cardPay ? String(cardPay.amount) : "");
    const nonCard = item.sale.payments.find((p: { method: PaymentMethod; amount: number }) => p.method !== "CARD");
    setMethod(nonCard?.method === "BANK_TRANSFER" ? "BANK_TRANSFER" : "CASH");
    void removeQueuedSale(item.clientUuid, tenantId).then(() => refreshQueue(tenantId));
    setNotice({
      type: "info",
      message: "فروش دارای مغایرت در سبد خرید بارگذاری شد. اقلام یا مبالغ را اصلاح و مجدداً ثبت نمایید.",
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canCreate || !tenantId) {
      setNotice({ type: "error", message: "شما مجوز ثبت فروش در پایانه را ندارید." });
      return;
    }
    if (vatRate === null) {
      setNotice({
        type: "error",
        message: "نرخ مالیات بر ارزش افزوده سازمان هنوز دریافت نشده است؛ برای محاسبه دقیق، ابتدا در حالت آنلاین صفحه را بارگذاری کنید.",
      });
      return;
    }
    if (hasExceededSafeBounds || estimatedPayableNumber === null) {
      setNotice({
        type: "error",
        message: "مبالغ واردشده فراتر از سقف اعداد معتبر محاسباتی سیستم است. لطفاً مبالغ را اصلاح کنید.",
      });
      return;
    }
    if (validLines.length === 0) {
      setNotice({ type: "error", message: "حداقل یک سطر با کد یا شرح، تعداد و قیمت معتبر وارد کنید." });
      return;
    }

    const payments = splitPosPayment(cartTotals.payableTotal, cardAmount, method);
    if (!payments) {
      setNotice({ type: "error", message: "مبلغ پرداختی کارتخوان نامعتبر یا بیشتر از مبلغ کل است." });
      return;
    }

    const dtoLines = validLines
      .map((l) => {
        const qty = parsePosQuantity(l.quantity);
        const unitPrice = parsePosUnitPrice(l.unitPrice);
        if (qty === null || unitPrice === null) return null;
        return {
          code: l.code.trim() || undefined,
          description: l.description.trim() || undefined,
          quantity: qty,
          unitPrice,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (dtoLines.length === 0) {
      setNotice({ type: "error", message: "حداقل یک سطر فروش معتبر وارد کنید." });
      return;
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 120) {
      setNotice({ type: "error", message: "نام مشتری نمی‌تواند بیش از ۱۲۰ کاراکتر باشد." });
      return;
    }

    const normalizedWh = warehouseId.trim() ? normaliseNumericInput(warehouseId) : "";
    const parsedWh = normalizedWh ? Number.parseInt(normalizedWh, 10) : undefined;

    const clientUuid = `pos-${generateClientUuid()}`;
    const salePayload: CreatePosSaleDto = {
      idempotencyKey: clientUuid,
      customer:
        phone.trim() || trimmedName
          ? { phone: phone.trim() || undefined, name: trimmedName || undefined }
          : undefined,
      lines: dtoLines,
      payments,
      warehouseId: parsedWh && parsedWh > 0 ? parsedWh : undefined,
    };

    setBusy(true);
    setNotice(null);

    // Queue offline immediately when navigator reports offline
    if (!isOnline) {
      try {
        await queueOfflineSale(salePayload, tenantId);
        await refreshQueue(tenantId);
        setNotice({
          type: "info",
          message: `فروش با موفقیت در صف آفلاین ذخیره شد (شناسه: ${clientUuid.slice(0, 12)}). به محض اتصال به اینترنت همگام‌سازی خواهد شد.`,
        });
        resetForm();
      } catch {
        setNotice({
          type: "error",
          message: "خطا در ذخیره‌سازی آفلاین: حافظه مرورگر در دسترس نیست یا مسدود شده است.",
        });
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      const result = await createPosSale(salePayload);
      setLastInvoice(result.invoice);
      setNotice({
        type: "success",
        message: `فروش با شماره ${result.invoice.taxInvoiceNumber} با موفقیت ثبت شد.`,
      });
      resetForm();
    } catch (err: unknown) {
      if (isOfflineOrTransientError(err)) {
        try {
          // Network drop / 5xx during live submission -> fall back safely to offline queue
          await queueOfflineSale(salePayload, tenantId);
          await refreshQueue(tenantId);
          setNotice({
            type: "info",
            message: "ارتباط با سرور برقرار نشد؛ فروش در صف آفلاین ذخیره شد و به محض اتصال مجدد ثبت خواهد شد.",
          });
          resetForm();
        } catch {
          setNotice({
            type: "error",
            message: "ارتباط با سرور قطع شد و ذخیره‌سازی آفلاین در مرورگر نیز با خطا مواجه شد. کالا را تحویل ندهید.",
          });
        }
      } else {
        // 4xx validation or permission error -> show directly without queueing a permanently failing sale
        setNotice({
          type: "error",
          message: err instanceof Error ? err.message : "خطا در ثبت فروش؛ ورودی‌ها را بررسی کنید.",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = queuedSales.filter((s) => s.status === "pending" || s.status === "syncing").length;
  const conflictSales = queuedSales.filter((s) => s.status === "conflict");

  if (!accessLoading && (!canRead || !canCreate)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="پایانه فروشگاهی و صندوق (POS)"
          description="فروش سریع پشت صندوق"
        />
        <Card className="p-6 text-sm text-rose-600">
          دسترسی شما به پایانه فروشگاهی مجاز نیست (نیاز به مجوز ایجاد فاکتور دارید).
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="پایانه فروشگاهی و صندوق (POS)"
        description="فروش سریع پشت صندوق با قابلیت کارکرد کامل در زمان قطع اینترنت، ثبت در صف محلی و همگام‌سازی خودکار"
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
                    variant="secondary"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => editConflictedSale(item)}
                  >
                    ویرایش در سبد
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!isOnline || syncing}
                    onClick={() => void handleSync(item.clientUuid)}
                  >
                    تلاش مجدد
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-rose-600"
                    onClick={async () => {
                      if (
                        typeof window !== "undefined" &&
                        !window.confirm("این فروش هنوز در سرور ثبت نشده است. آیا از حذف دائمی آن اطمینان دارید؟")
                      ) {
                        return;
                      }
                      await removeQueuedSale(item.clientUuid, tenantId);
                      await refreshQueue(tenantId);
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
                <span className="text-xs text-muted-foreground">
                  {vatRate !== null
                    ? `مالیات بر ارزش افزوده ${toFaDigits(vatRate)}٪ به‌صورت خودکار محاسبه می‌شود`
                    : "نرخ مالیات سازمان هنوز بارگذاری نشده است (نیازمند یک‌بار اتصال آنلاین)"}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="pos-phone">تلفن مشتری (اختیاری)</Label>
                  <Input
                    id="pos-phone"
                    dir="ltr"
                    inputMode="tel"
                    maxLength={32}
                    placeholder="0912..."
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="pos-name">نام مشتری (اختیاری)</Label>
                  <Input
                    id="pos-name"
                    maxLength={120}
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
                  <span className="font-semibold">{formatMoneyRial(estimatedPayableNumber)}</span>
                </div>

                <Button type="submit" disabled={busy || validLines.length === 0 || !canCreate || vatRate === null}>
                  <ShoppingBag className="h-4 w-4" />
                  {isOnline ? "ثبت فروش آنلاین" : "ثبت در صف آفلاین"}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        {/* Queue, Live 80mm Receipt Preview & Activity Sidebar */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between pb-3 border-b">
              <h3 className="text-sm font-semibold">پیش‌نمایش فیش ۸۰ میلی‌متری</h3>
              {lastInvoice && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => printPosReceipt(lastInvoice)}
                >
                  <Printer className="h-3.5 w-3.5" />
                  چاپ فیش حرارتی
                </Button>
              )}
            </div>

            {lastInvoice ? (
              <div className="mt-3 space-y-2 rounded-md border bg-muted/20 p-3 text-xs font-mono">
                <div className="flex justify-between font-semibold">
                  <span>شماره فیش:</span>
                  <span>{lastInvoice.taxInvoiceNumber}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>مشتری:</span>
                  <span>{lastInvoice.buyerInfo?.name || "مشتری گذری"}</span>
                </div>
                <div className="border-t pt-2 space-y-1">
                  {lastInvoice.items.map((it, idx) => (
                    <div key={`${it.description}-${idx}`} className="flex justify-between">
                      <span className="truncate max-w-[160px]">{it.description} × {toFaDigits(it.quantity)}</span>
                      <span>{formatMoneyRial(it.total)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-2 flex justify-between font-bold">
                  <span>قابل پرداخت:</span>
                  <span>{formatMoneyRial(lastInvoice.finalPayable)}</span>
                </div>
              </div>
            ) : (
              <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>جمع خالص سبد:</span>
                  <span>{formatMoneyRial(bigintToSafeJsonNumber(cartTotals.netTotal))}</span>
                </div>
                <div className="flex justify-between">
                  <span>مالیات ({vatRate !== null ? `${toFaDigits(vatRate)}٪` : "نامشخص"}):</span>
                  <span>{formatMoneyRial(bigintToSafeJsonNumber(cartTotals.vatTotal))}</span>
                </div>
                <div className="flex justify-between font-semibold text-foreground border-t pt-1.5">
                  <span>مبلغ نهایی:</span>
                  <span>{formatMoneyRial(estimatedPayableNumber)}</span>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between pb-3 border-b">
              <h3 className="text-sm font-semibold">صف فروش‌های محلی</h3>
              {queuedSales.some((s) => s.status === "synced") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={async () => {
                    await clearSyncedSales(tenantId);
                    await refreshQueue(tenantId);
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
                  <div key={item.clientUuid} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs">{item.clientUuid.slice(0, 16)}</p>
                      <span className="text-muted-foreground">
                        {item.sale.lines.length} قلم کالا • {item.createdAt.slice(11, 19)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {item.status === "pending" && (
                        <span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-600 font-medium">در صف</span>
                      )}
                      {item.status === "syncing" && (
                        <span className="rounded bg-sky-500/10 px-2 py-0.5 text-sky-600 font-medium">ارسال...</span>
                      )}
                      {item.status === "synced" && (
                        <>
                          <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-emerald-600 font-medium">ارسال شد</span>
                          {item.invoice && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5"
                              title="چاپ فیش"
                              onClick={() => {
                                setLastInvoice(item.invoice!);
                                printPosReceipt(item.invoice!);
                              }}
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </>
                      )}
                      {item.status === "conflict" && (
                        <span className="rounded bg-rose-500/10 px-2 py-0.5 text-rose-600 font-medium">
                          {CONFLICT_BADGE_LABELS[item.conflictCode ?? "UNKNOWN"]}
                        </span>
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
