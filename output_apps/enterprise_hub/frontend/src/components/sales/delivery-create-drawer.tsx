"use client";

import { useEffect, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createSalesDelivery } from "@/lib/api/sales-client";
import { formatSalesQuantity } from "./sales-format";
import type { SalesDelivery, SalesOrder } from "@/types/sales";

interface DeliveryLineState {
  orderLineId: number;
  itemId: number;
  description: string;
  ordered: number;
  delivered: number;
  toDeliver: string;
}

interface DeliveryCreateDrawerProps {
  order: SalesOrder | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (delivery: SalesDelivery) => void;
}

export function DeliveryCreateDrawer({
  order,
  open,
  onClose,
  onSuccess,
}: DeliveryCreateDrawerProps) {
  const today = new Date().toISOString().split("T")[0];
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DeliveryLineState[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (order && order.lines) {
      setLines(
        order.lines.map((l) => {
          const remaining = Math.max(0, l.quantity - (l.deliveredQuantity || 0));
          return {
            orderLineId: l.id,
            itemId: l.itemId,
            description: l.description || "",
            ordered: l.quantity,
            delivered: l.deliveredQuantity || 0,
            toDeliver: remaining > 0 ? String(remaining) : "0",
          };
        }),
      );
    } else {
      setLines([]);
    }
  }, [order]);

  if (!order) return null;

  const updateLineQty = (idx: number, val: string) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], toDeliver: val };
    setLines(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validLines = lines
      .map((l) => ({
        orderLineId: l.orderLineId,
        quantity: parseFloat(l.toDeliver),
      }))
      .filter((l) => !isNaN(l.quantity) && l.quantity > 0);

    if (validLines.length === 0) {
      setError("حداقل باید برای یکی از سطرهای سفارش مقدار تحویل مثبت مشخص شود.");
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `del-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const res = await createSalesDelivery(order.id, {
        deliveryDate: deliveryDate.trim(),
        idempotencyKey,
        note: note.trim() || undefined,
        lines: validLines,
      });

      onSuccess(res);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در صدور حواله خروج فروش.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`صدور حواله خروج برای سفارش ${order.number}`}
      description="مقادیر تحویل شده به مشتری را مشخص کنید تا حواله انبار و سند مالی متناظر ثبت شود."
      size="xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" data-testid="delivery-create-form">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label>مشتری / طرف‌حساب</Label>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-medium">
              {order.partyCode}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="del-date">تاریخ تحویل (YYYY-MM-DD) *</Label>
            <Input
              id="del-date"
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="del-note">یادداشت حواله</Label>
            <Input
              id="del-note"
              placeholder="اختیاری..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        {/* Lines selection */}
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-semibold">اقلام سفارش جهت تحویل</Label>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-right text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-center">شناسه کالا</th>
                  <th className="px-3 py-2">شرح</th>
                  <th className="px-3 py-2 text-center">سفارش داده‌شده</th>
                  <th className="px-3 py-2 text-center">قبلاً تحویل شده</th>
                  <th className="px-3 py-2 text-center">باقیمانده</th>
                  <th className="px-3 py-2 text-center w-36">مقدار تحویل فعلی</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l, idx) => {
                  const remaining = Math.max(0, l.ordered - l.delivered);
                  return (
                    <tr key={l.orderLineId} className="hover:bg-muted/20">
                      <td className="px-3 py-2.5 text-center font-medium">{l.itemId}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{l.description || "—"}</td>
                      <td className="px-3 py-2.5 text-center">{formatSalesQuantity(l.ordered)}</td>
                      <td className="px-3 py-2.5 text-center text-muted-foreground">
                        {formatSalesQuantity(l.delivered)}
                      </td>
                      <td className="px-3 py-2.5 text-center font-semibold text-primary">
                        {formatSalesQuantity(remaining)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max={remaining}
                          value={l.toDeliver}
                          onChange={(e) => updateLineQty(idx, e.target.value)}
                          className="h-8 text-center text-xs"
                          aria-label={`مقدار تحویل برای سطر کالای ${l.itemId}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            انصراف
          </Button>
          <Button type="submit" disabled={submitting} className="min-w-28">
            {submitting ? "در حال صدور حواله..." : "صدور حواله خروج"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
