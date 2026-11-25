"use client";

import { useState } from "react";
import { Check, CheckCircle2, Truck, X } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cancelSalesOrder, confirmSalesOrder } from "@/lib/api/sales-client";
import { formatSalesMoney, formatSalesQuantity } from "./sales-format";
import { formatJalaliDate } from "@/lib/fa-format";
import type { SalesOrder } from "@/types/sales";

interface SalesOrderDetailDrawerProps {
  order: SalesOrder | null;
  open: boolean;
  canApprove?: boolean;
  canCreate?: boolean;
  onClose: () => void;
  onUpdated: (updated: SalesOrder) => void;
  onCreateDelivery: (order: SalesOrder) => void;
}

const ORDER_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "پیش‌نویس", variant: "secondary" },
  CONFIRMED: { label: "تأییدشده", variant: "default" },
  CANCELLED: { label: "لغو شده", variant: "destructive" },
};

export function SalesOrderDetailDrawer({
  order,
  open,
  canApprove = true,
  canCreate = true,
  onClose,
  onUpdated,
  onCreateDelivery,
}: SalesOrderDetailDrawerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!order) return null;

  const statusConfig = ORDER_STATUS_MAP[order.status] ?? {
    label: order.status,
    variant: "secondary",
  };

  const handleConfirm = async () => {
    if (!confirm("آیا از تأیید این سفارش فروش اطمینان دارید؟ موجودی کالا رزرو خواهد شد.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await confirmSalesOrder(order.id);
      onUpdated(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در تأیید سفارش فروش.");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm("آیا از لغو این سفارش فروش اطمینان دارید؟")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await cancelSalesOrder(order.id);
      onUpdated(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در لغو سفارش فروش.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`سفارش فروش ${order.number}`}
      description={`مشتری: ${order.partyCode} | ثبت: ${formatJalaliDate(order.createdAt)}`}
      size="xl"
    >
      <div className="flex flex-col gap-6" data-testid="sales-order-detail-view">
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
            <p className="text-xs text-muted-foreground">انبار خروج</p>
            <p className="mt-1 text-sm font-semibold text-foreground">انبار {order.warehouseId}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">مبلغ کل سفارش</p>
            <p className="mt-1 text-sm font-bold text-foreground text-indigo-600">
              {formatSalesMoney(order.totalAmount)}
            </p>
          </div>
          {order.promisedDate && (
            <div>
              <p className="text-xs text-muted-foreground">وعده تحویل</p>
              <p className="mt-1 text-xs text-foreground">{order.promisedDate}</p>
            </div>
          )}
          {order.note && (
            <div className="col-span-3">
              <p className="text-xs text-muted-foreground">یادداشت</p>
              <p className="mt-1 text-xs text-foreground">{order.note}</p>
            </div>
          )}
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          {order.status === "DRAFT" && canApprove && (
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={busy}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Check className="size-4" />
              تأیید سفارش فروش (رزرو موجودی)
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

          {order.status === "CONFIRMED" && canCreate && (
            <Button
              size="sm"
              onClick={() => {
                onClose();
                onCreateDelivery(order);
              }}
              className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <Truck className="size-4" />
              صدور حواله تحویل کالا (کسر انبار)
            </Button>
          )}
        </div>

        {/* Lines table */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">اقلام سفارش فروش</h3>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">ردیف</TableHead>
                  <TableHead className="text-right">کد کالا</TableHead>
                  <TableHead className="text-right">شرح</TableHead>
                  <TableHead className="text-center">مقدار سفارش</TableHead>
                  <TableHead className="text-center">تحویل‌شده</TableHead>
                  <TableHead className="text-center">صورتحساب‌شده</TableHead>
                  <TableHead className="text-center">بهای واحد (ریال)</TableHead>
                  <TableHead className="text-left">جمع سطر (ریال)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines?.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="text-center tabular-nums text-xs text-muted-foreground">
                      {line.lineNo}
                    </TableCell>
                    <TableCell className="font-medium">کالا {line.itemId}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {line.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-center tabular-nums font-semibold">
                      {formatSalesQuantity(line.quantity)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums text-emerald-600">
                      {formatSalesQuantity(line.deliveredQuantity)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums text-purple-600">
                      {formatSalesQuantity(line.invoicedQuantity)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatSalesMoney(line.unitPrice)}
                    </TableCell>
                    <TableCell className="text-left tabular-nums font-semibold">
                      {formatSalesMoney(line.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
