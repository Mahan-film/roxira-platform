"use client";

import { useEffect, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createGoodsReceipt } from "@/lib/api/purchasing-client";
import { formatQuantity } from "./purchasing-format";
import type { GoodsReceipt, PurchaseOrder } from "@/types/purchasing";

interface ReceiptLineState {
  orderLineId: string;
  sku: string;
  orderedQty: string;
  alreadyReceivedQty: string;
  remainingQty: number; // in normal units
  receiveQty: string; // normal units string
  weightKg: string; // kg string
}

interface ReceiptCreateDrawerProps {
  order: PurchaseOrder | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (receipt: GoodsReceipt) => void;
}

export function ReceiptCreateDrawer({
  order,
  open,
  onClose,
  onSuccess,
}: ReceiptCreateDrawerProps) {
  const [lines, setLines] = useState<ReceiptLineState[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!order) return;
    const initial: ReceiptLineState[] = order.lines.map((l) => {
      const ord = Number(l.quantity) / 100;
      const rec = Number(l.receivedQuantity) / 100;
      const rem = Math.max(0, ord - rec);
      return {
        orderLineId: l.id,
        sku: l.sku,
        orderedQty: l.quantity,
        alreadyReceivedQty: l.receivedQuantity,
        remainingQty: rem,
        receiveQty: rem > 0 ? rem.toString() : "0",
        weightKg: "",
      };
    });
    setLines(initial);
    setIdempotencyKey(`rcpt-${order.id.slice(0, 8)}-${Date.now()}`);
  }, [order, open]);

  if (!order) return null;

  const updateLine = (idx: number, field: "receiveQty" | "weightKg", value: string) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], [field]: value };
    setLines(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const activeLines = lines.filter((l) => parseFloat(l.receiveQty) > 0);
    if (activeLines.length === 0) {
      setError("حداقل برای یک قلم کالا مقدار دریافت باید بیشتر از صفر باشد.");
      return;
    }

    setSubmitting(true);
    try {
      const payloadLines = activeLines.map((l) => {
        const qtyHundredths = Math.round(parseFloat(l.receiveQty) * 100).toString();
        const weightThousandths = l.weightKg.trim()
          ? Math.round(parseFloat(l.weightKg) * 1000).toString()
          : undefined;

        return {
          orderLineId: l.orderLineId,
          quantity: qtyHundredths,
          weight: weightThousandths,
        };
      });

      const res = await createGoodsReceipt(order.id, {
        lines: payloadLines,
        idempotencyKey: idempotencyKey.trim() || undefined,
      });

      onSuccess(res);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در ثبت رسید انبار.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`ثبت رسید کالا برای سفارش ${order.number}`}
      description={`تأمین‌کننده: ${order.supplierCode} | انبار: ${order.warehouseId ?? "عمومی"}`}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" data-testid="receipt-create-form">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-1.5 sm:w-1/2">
          <Label htmlFor="receipt-idempotency">شناسه یکتای دریافت (Idempotency Key)</Label>
          <Input
            id="receipt-idempotency"
            value={idempotencyKey}
            onChange={(e) => setIdempotencyKey(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-sm font-semibold">اقلام دریافتی</Label>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">کد کالا (SKU)</TableHead>
                  <TableHead className="text-center">کل سفارش</TableHead>
                  <TableHead className="text-center">قبلاً دریافتی</TableHead>
                  <TableHead className="text-center">باقی‌مانده</TableHead>
                  <TableHead className="w-36 text-center">مقدار دریافتی این رسید *</TableHead>
                  <TableHead className="w-32 text-center">وزن تقریبی (kg)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, idx) => (
                  <TableRow key={l.orderLineId}>
                    <TableCell className="font-medium">{l.sku}</TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatQuantity(l.orderedQty)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatQuantity(l.alreadyReceivedQty)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums font-semibold text-amber-600">
                      {l.remainingQty.toLocaleString("fa-IR")}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={l.receiveQty}
                        onChange={(e) => updateLine(idx, "receiveQty", e.target.value)}
                        className="text-center tabular-nums"
                        aria-label={`مقدار دریافتی برای ${l.sku}`}
                        required
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        placeholder="اختیاری"
                        value={l.weightKg}
                        onChange={(e) => updateLine(idx, "weightKg", e.target.value)}
                        className="text-center tabular-nums text-xs"
                        aria-label={`وزن برای ${l.sku}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            انصراف
          </Button>
          <Button type="submit" disabled={submitting} className="min-w-32">
            {submitting ? "در حال ثبت رسید..." : "ثبت رسید کالا"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
