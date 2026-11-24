"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createPurchaseOrder } from "@/lib/api/purchasing-client";
import { formatMinorMoney, parseDecimalToScaledBigInt } from "./purchasing-format";
import type { PurchaseOrder } from "@/types/purchasing";

interface OrderLineInput {
  sku: string;
  quantity: string; // e.g. "10" (will be converted to "1000")
  unitPrice: string; // e.g. "50000" in Rials (will be converted to minor cents "5000000")
}

interface OrderCreateDrawerProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (order: PurchaseOrder) => void;
}

export function OrderCreateDrawer({
  open,
  onClose,
  onSuccess,
}: OrderCreateDrawerProps) {
  const today = new Date().toISOString().split("T")[0];
  const [supplierCode, setSupplierCode] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [orderDate, setOrderDate] = useState(today);
  const [lines, setLines] = useState<OrderLineInput[]>([
    { sku: "", quantity: "1", unitPrice: "0" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addLine = () => {
    setLines([...lines, { sku: "", quantity: "1", unitPrice: "0" }]);
  };

  const removeLine = (idx: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: keyof OrderLineInput, value: string) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], [field]: value };
    setLines(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedSupplier = supplierCode.trim();
    if (!trimmedSupplier) {
      setError("لطفاً کد تأمین‌کننده را وارد کنید.");
      return;
    }

    if (lines.length === 0) {
      setError("حداقل یک سطر سفارش باید ثبت شود.");
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.sku.trim()) {
        setError(`لطفاً کد کالای سطر ${i + 1} را وارد کنید.`);
        return;
      }
      const qtyHundredths = parseDecimalToScaledBigInt(l.quantity, 2);
      if (qtyHundredths === null || qtyHundredths <= 0n) {
        setError(`مقدار سطر ${i + 1} نامعتبر است.`);
        return;
      }
      const priceMinor = parseDecimalToScaledBigInt(l.unitPrice, 2);
      if (priceMinor === null) {
        setError(`قیمت واحد سطر ${i + 1} نامعتبر است.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const orderLines = lines.map((l) => {
        const qtyHundredths = parseDecimalToScaledBigInt(l.quantity, 2) ?? 0n;
        const priceMinor = parseDecimalToScaledBigInt(l.unitPrice, 2) ?? 0n;
        return {
          sku: l.sku.trim(),
          quantity: qtyHundredths.toString(),
          unitPrice: priceMinor.toString(),
        };
      });

      const res = await createPurchaseOrder({
        supplierCode: trimmedSupplier,
        orderDate: orderDate.trim(),
        warehouseId: warehouseId ? parseInt(warehouseId, 10) : undefined,
        lines: orderLines,
      });

      onSuccess(res);
      onClose();
      // Reset form
      setSupplierCode("");
      setWarehouseId("");
      setLines([{ sku: "", quantity: "1", unitPrice: "0" }]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در ثبت سفارش خرید.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="ثبت سفارش خرید جدید"
      description="مشخصات سفارش خرید پیش‌نویس (DRAFT) و اقلام مورد نیاز را وارد کنید."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" data-testid="order-create-form">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-supplier-code">کد تأمین‌کننده *</Label>
            <Input
              id="order-supplier-code"
              placeholder="مثال: SUP-1001"
              value={supplierCode}
              onChange={(e) => setSupplierCode(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-date">تاریخ سفارش (میلادی YYYY-MM-DD) *</Label>
            <Input
              id="order-date"
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-warehouse-id">شناسه انبار (اختیاری)</Label>
            <Input
              id="order-warehouse-id"
              type="number"
              min="1"
              placeholder="مثال: 1"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">اقلام سفارش</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLine}
              className="gap-1.5"
            >
              <Plus className="size-3.5" />
              افزودن سطر
            </Button>
          </div>

          <div className="flex flex-col gap-2.5">
            {lines.map((line, idx) => {
              const qtyH = parseDecimalToScaledBigInt(line.quantity, 2) ?? 0n;
              const priceM = parseDecimalToScaledBigInt(line.unitPrice, 2) ?? 0n;
              const estMinor = ((qtyH * priceM) / 100n).toString();

              return (
                <div
                  key={idx}
                  className="grid grid-cols-12 items-end gap-2.5 rounded-lg border border-border p-3 bg-muted/20"
                >
                  <div className="col-span-12 sm:col-span-4 flex flex-col gap-1">
                    <Label htmlFor={`line-sku-${idx}`} className="text-xs">
                      کد کالا (SKU) *
                    </Label>
                    <Input
                      id={`line-sku-${idx}`}
                      placeholder="مثال: SKU-01"
                      value={line.sku}
                      onChange={(e) => updateLine(idx, "sku", e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3 flex flex-col gap-1">
                    <Label htmlFor={`line-qty-${idx}`} className="text-xs">
                      مقدار *
                    </Label>
                    <Input
                      id={`line-qty-${idx}`}
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-4 flex flex-col gap-1">
                    <Label htmlFor={`line-price-${idx}`} className="text-xs">
                      قیمت واحد (ریال) *
                    </Label>
                    <Input
                      id={`line-price-${idx}`}
                      type="number"
                      min="0"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(idx, "unitPrice", e.target.value)}
                      required
                    />
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      جمع: {formatMinorMoney(estMinor)}
                    </span>
                  </div>
                  <div className="col-span-12 sm:col-span-1 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length <= 1}
                      aria-label={`حذف سطر ${idx + 1}`}
                      className="text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            انصراف
          </Button>
          <Button type="submit" disabled={submitting} className="min-w-28">
            {submitting ? "در حال ثبت..." : "ثبت سفارش"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
