"use client";

import { useState } from "react";
import { Check, CheckCircle2, PackageCheck, Receipt, X, XCircle } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
} from "@/lib/api/purchasing-client";
import { formatMinorMoney, formatQuantity } from "./purchasing-format";
import { formatJalaliDate } from "@/lib/fa-format";
import type { PurchaseOrder } from "@/types/purchasing";

interface OrderDetailDrawerProps {
  order: PurchaseOrder | null;
  open: boolean;
  canApprove?: boolean;
  canPost?: boolean;
  onClose: () => void;
  onUpdated: (updated: PurchaseOrder) => void;
  onCreateReceipt: (order: PurchaseOrder) => void;
  onCreateInvoice: (order: PurchaseOrder) => void;
}

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "پیش‌نویس", variant: "secondary" },
  APPROVED: { label: "تأییدشده", variant: "default" },
  PARTIALLY_RECEIVED: { label: "دریافت جزئی", variant: "outline" },
  FULLY_RECEIVED: { label: "دریافت کامل", variant: "default" },
  CLOSED: { label: "بسته شده", variant: "secondary" },
  CANCELLED: { label: "لغو شده", variant: "destructive" },
};

export function OrderDetailDrawer({
  order,
  open,
  canApprove = true,
  canPost = true,
  onClose,
  onUpdated,
  onCreateReceipt,
  onCreateInvoice,
}: OrderDetailDrawerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!order) return null;

  const statusConfig = STATUS_MAP[order.status] ?? {
    label: order.status,
    variant: "secondary",
  };

  const handleApprove = async () => {
    if (!confirm("آیا از تأیید این سفارش اطمینان دارید؟")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await approvePurchaseOrder(order.id);
      onUpdated(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در تأیید سفارش.");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm("آیا از لغو این سفارش اطمینان دارید؟")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await cancelPurchaseOrder(order.id);
      onUpdated(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در لغو سفارش.");
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    if (!confirm("آیا از بستن سفارش نیمه‌دریافت‌شده اطمینان دارید؟")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await closePurchaseOrder(order.id);
      onUpdated(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در بستن سفارش.");
    } finally {
      setBusy(false);
    }
  };

  // Compute total order value
  let totalOrderMinor = 0n;
  for (const line of order.lines) {
    try {
      // line.quantity hundredths, line.unitPrice minor units => line value = (qty * unitPrice) / 100
      const q = BigInt(line.quantity);
      const p = BigInt(line.unitPrice);
      totalOrderMinor += (q * p) / 100n;
    } catch {
      // ignore parse error
    }
  }

  const isApprovedOrPartial =
    order.status === "APPROVED" || order.status === "PARTIALLY_RECEIVED";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`سفارش خرید ${order.number}`}
      description={`تأمین‌کننده: ${order.supplierCode} | ثبت: ${formatJalaliDate(order.createdAt)}`}
      size="xl"
    >
      <div className="flex flex-col gap-6" data-testid="order-detail-view">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Metadata summary */}
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-border p-4 bg-muted/20 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">وضعیت سفارش</p>
            <div className="mt-1">
              <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">تاریخ سفارش</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{order.orderDate}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">شناسه انبار</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{order.warehouseId ?? "عمومی"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">مبلغ برآوردی کل</p>
            <p className="mt-1 text-sm font-bold text-foreground">
              {formatMinorMoney(totalOrderMinor.toString())}
            </p>
          </div>
          {order.approvedBy && (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">تأییدشده توسط</p>
              <p className="mt-0.5 text-xs text-foreground">
                {order.approvedBy} {order.approvedAt ? `در ${formatJalaliDate(order.approvedAt)}` : ""}
              </p>
            </div>
          )}
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          {order.status === "DRAFT" && canApprove && (
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={busy}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Check className="size-4" />
              تأیید سفارش
            </Button>
          )}

          {order.status === "DRAFT" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
              disabled={busy}
              className="gap-1.5 text-destructive hover:bg-destructive/10"
            >
              <X className="size-4" />
              لغو سفارش
            </Button>
          )}

          {order.status === "PARTIALLY_RECEIVED" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleClose}
              disabled={busy}
              className="gap-1.5"
            >
              <CheckCircle2 className="size-4" />
              بستن سفارش
            </Button>
          )}

          {isApprovedOrPartial && canPost && (
            <Button
              size="sm"
              onClick={() => {
                onClose();
                onCreateReceipt(order);
              }}
              className="gap-1.5"
            >
              <PackageCheck className="size-4" />
              ثبت رسید انبار
            </Button>
          )}

          {order.status !== "DRAFT" && order.status !== "CANCELLED" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onClose();
                onCreateInvoice(order);
              }}
              className="gap-1.5"
            >
              <Receipt className="size-4" />
              ثبت صورتحساب خرید
            </Button>
          )}
        </div>

        {/* Lines table */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">اقلام سفارش</h3>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">کد کالا (SKU)</TableHead>
                  <TableHead className="text-center">مقدار سفارش</TableHead>
                  <TableHead className="text-center">مقدار دریافتی</TableHead>
                  <TableHead className="text-center">قیمت واحد</TableHead>
                  <TableHead className="text-left">ارزش کل سطر</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((line) => {
                  let lineTotalMinor = 0n;
                  try {
                    lineTotalMinor = (BigInt(line.quantity) * BigInt(line.unitPrice)) / 100n;
                  } catch {
                    // ignore
                  }

                  return (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">{line.sku}</TableCell>
                      <TableCell className="text-center tabular-nums">
                        {formatQuantity(line.quantity)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {formatQuantity(line.receivedQuantity)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {formatMinorMoney(line.unitPrice)}
                      </TableCell>
                      <TableCell className="text-left tabular-nums font-semibold">
                        {formatMinorMoney(lineTotalMinor.toString())}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
