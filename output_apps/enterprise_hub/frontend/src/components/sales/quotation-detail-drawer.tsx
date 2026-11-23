"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, Send, ArrowRightLeft, AlertTriangle } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { changeQuotationStatus, convertQuotation } from "@/lib/api/sales-client";
import { formatSalesMoney, formatSalesQuantity } from "./sales-format";
import type { SalesOrder, SalesQuotation, SalesQuotationStatus } from "@/types/sales";

interface QuotationDetailDrawerProps {
  quotation: SalesQuotation | null;
  open: boolean;
  onClose: () => void;
  onQuotationUpdated: (updated: SalesQuotation) => void;
  onConvertedToOrder?: (order: SalesOrder) => void;
}

export function QuotationDetailDrawer({
  quotation,
  open,
  onClose,
  onQuotationUpdated,
  onConvertedToOrder,
}: QuotationDetailDrawerProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Convert form state
  const [showConvertForm, setShowConvertForm] = useState(false);
  const [warehouseId, setWarehouseId] = useState("1");
  const [orderDate, setOrderDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [promisedDate, setPromisedDate] = useState("");

  if (!quotation) return null;

  const handleStatusChange = async (nextStatus: SalesQuotationStatus) => {
    setError(null);
    setSuccessMsg(null);
    setLoadingAction(`status-${nextStatus}`);
    try {
      const updated = await changeQuotationStatus(quotation.id, nextStatus);
      onQuotationUpdated(updated);
      setSuccessMsg(`وضعیت پیش‌فاکتور با موفقیت به ${nextStatus} تغییر یافت.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در تغییر وضعیت پیش‌فاکتور.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const whId = parseInt(warehouseId, 10);
    if (isNaN(whId) || whId <= 0) {
      setError("شناسه انبار نامعتبر است.");
      return;
    }

    setLoadingAction("convert");
    try {
      const newOrder = await convertQuotation(quotation.id, {
        warehouseId: whId,
        orderDate: orderDate.trim(),
        promisedDate: promisedDate.trim() || undefined,
      });

      // Update current quote status to CONVERTED
      onQuotationUpdated({
        ...quotation,
        status: "CONVERTED",
      });
      setSuccessMsg(`پیش‌فاکتور با موفقیت به سفارش فروش ${newOrder.number} تبدیل شد.`);
      setShowConvertForm(false);
      if (onConvertedToOrder) {
        onConvertedToOrder(newOrder);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در تبدیل پیش‌فاکتور به سفارش فروش.");
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`پیش‌فاکتور فروش: ${quotation.number}`}
      description="جزئیات اقلام، وضعیت پیش‌فاکتور و تبدیل به سفارش فروش"
      size="xl"
    >
      <div className="flex flex-col gap-6" data-testid="quotation-detail-view">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {successMsg && (
          <Alert className="border-emerald-500/50 bg-emerald-50/50 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300">
            <AlertDescription>{successMsg}</AlertDescription>
          </Alert>
        )}

        {/* Top Info Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-lg border border-border p-4 bg-muted/20">
          <div>
            <div className="text-xs text-muted-foreground">کد طرف‌حساب / مشتری</div>
            <div className="font-semibold">{quotation.partyCode}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">تاریخ پیش‌فاکتور</div>
            <div className="font-semibold">{quotation.quoteDate}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">مهلت اعتبار</div>
            <div className="font-semibold">{quotation.validUntil || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">مبلغ کل</div>
            <div className="font-semibold text-primary">
              {formatSalesMoney(quotation.totalAmount)}
            </div>
          </div>
        </div>

        {quotation.note && (
          <div className="rounded-md border border-border p-3 text-sm bg-background">
            <span className="font-medium text-muted-foreground">یادداشت: </span>
            {quotation.note}
          </div>
        )}

        {quotation.warning && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="size-4 shrink-0 text-amber-500" />
            <span>{quotation.warning}</span>
          </div>
        )}

        {/* Action Buttons bar */}
        <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border/80 bg-muted/30 p-3">
          <span className="text-xs font-semibold text-muted-foreground">عملیات:</span>

          {quotation.status === "DRAFT" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleStatusChange("SENT")}
              disabled={!!loadingAction}
              className="gap-1.5"
            >
              <Send className="size-3.5" />
              {loadingAction === "status-SENT" ? "در حال ارسال..." : "ارسال به مشتری"}
            </Button>
          )}

          {quotation.status === "SENT" && (
            <>
              <Button
                size="sm"
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => handleStatusChange("ACCEPTED")}
                disabled={!!loadingAction}
              >
                <CheckCircle2 className="size-3.5" />
                {loadingAction === "status-ACCEPTED" ? "در حال ثبت..." : "تأیید مشتری"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleStatusChange("REJECTED")}
                disabled={!!loadingAction}
                className="gap-1.5"
              >
                <XCircle className="size-3.5" />
                {loadingAction === "status-REJECTED" ? "در حال ثبت..." : "رد پیش‌فاکتور"}
              </Button>
            </>
          )}

          {quotation.status === "ACCEPTED" && !showConvertForm && (
            <Button
              size="sm"
              onClick={() => setShowConvertForm(true)}
              className="gap-1.5"
            >
              <ArrowRightLeft className="size-3.5" />
              تبدیل به سفارش فروش
            </Button>
          )}

          {quotation.status === "CONVERTED" && (
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              این پیش‌فاکتور قبلاً به سفارش فروش تبدیل شده است.
            </span>
          )}
        </div>

        {/* Convert to SO Drawer / Form */}
        {showConvertForm && (
          <form
            onSubmit={handleConvert}
            className="flex flex-col gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4"
          >
            <div className="text-sm font-semibold text-primary">
              تبدیل پیش‌فاکتور به سفارش فروش (Sales Order)
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="conv-wh-id" className="text-xs">
                  شناسه انبار خروج *
                </Label>
                <Input
                  id="conv-wh-id"
                  type="number"
                  min="1"
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="conv-order-date" className="text-xs">
                  تاریخ سفارش *
                </Label>
                <Input
                  id="conv-order-date"
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="conv-prom-date" className="text-xs">
                  تاریخ وعده تحویل (اختیاری)
                </Label>
                <Input
                  id="conv-prom-date"
                  type="date"
                  value={promisedDate}
                  onChange={(e) => setPromisedDate(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowConvertForm(false)}
                disabled={loadingAction === "convert"}
              >
                انصراف
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={loadingAction === "convert"}
              >
                {loadingAction === "convert" ? "در حال ایجاد سفارش..." : "تأیید و صدور سفارش"}
              </Button>
            </div>
          </form>
        )}

        {/* Lines Table */}
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-semibold">اقلام و ردیف‌های پیش‌فاکتور</Label>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-right text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-center">ردیف</th>
                  <th className="px-3 py-2">شناسه کالا</th>
                  <th className="px-3 py-2">شرح</th>
                  <th className="px-3 py-2 text-center">مقدار</th>
                  <th className="px-3 py-2">بهای واحد (ریال)</th>
                  <th className="px-3 py-2">تخفیف (ریال)</th>
                  <th className="px-3 py-2">مبلغ کل (ریال)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {quotation.lines && quotation.lines.length > 0 ? (
                  quotation.lines.map((l) => (
                    <tr key={l.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2.5 text-center text-muted-foreground">{l.lineNo}</td>
                      <td className="px-3 py-2.5 font-medium">{l.itemId}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{l.description || "—"}</td>
                      <td className="px-3 py-2.5 text-center font-medium">
                        {formatSalesQuantity(l.quantity)}
                      </td>
                      <td className="px-3 py-2.5">{formatSalesMoney(l.unitPrice)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {formatSalesMoney(l.discount)}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-primary">
                        {formatSalesMoney(l.lineTotal)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                      سطری یافت نشد.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
