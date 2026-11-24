"use client";

import { useEffect, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupplierInvoice, listGoodsReceipts } from "@/lib/api/purchasing-client";
import { formatMinorMoney, formatQuantity, parseDecimalToScaledBigInt } from "./purchasing-format";
import type { GoodsReceipt, PurchaseOrder, SupplierInvoice } from "@/types/purchasing";

interface InvoiceLineState {
  receiptLineId: string;
  sku: string;
  receivedQuantity: string;
  unitCost: string;
  invoiceQty: string; // normal units
  invoiceUnitPriceRials: string; // rials
}

interface InvoiceCreateDrawerProps {
  order: PurchaseOrder | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (invoice: SupplierInvoice) => void;
}

export function InvoiceCreateDrawer({
  order,
  open,
  onClose,
  onSuccess,
}: InvoiceCreateDrawerProps) {
  const today = new Date().toISOString().split("T")[0];
  const [supplierRef, setSupplierRef] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [vatRials, setVatRials] = useState("");
  const [lines, setLines] = useState<InvoiceLineState[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!order || !open) return;
    setLoadingReceipts(true);
    setError(null);

    listGoodsReceipts(order.id)
      .then((receipts) => {
        const flattenedLines: InvoiceLineState[] = [];
        for (const r of receipts) {
          for (const l of r.lines) {
            const q = BigInt(l.quantity);
            const whole = q / 100n;
            const frac = q % 100n;
            const qtyNormal =
              frac === 0n
                ? whole.toString()
                : `${whole}.${frac.toString().padStart(2, "0").replace(/0+$/, "")}`;
            // unit cost minor -> rial
            const unitPriceRials = (BigInt(l.unitCost) / 100n).toString();
            flattenedLines.push({
              receiptLineId: l.id,
              sku: l.sku,
              receivedQuantity: l.quantity,
              unitCost: l.unitCost,
              invoiceQty: qtyNormal,
              invoiceUnitPriceRials: unitPriceRials,
            });
          }
        }
        setLines(flattenedLines);
        if (flattenedLines.length === 0) {
          setError("برای این سفارش هنوز رسید کالایی ثبت نشده است. ابتدا رسید کالا را ثبت کنید.");
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "خطا در دریافت رسیدهای سفارش.");
      })
      .finally(() => {
        setLoadingReceipts(false);
      });
  }, [order, open]);

  if (!order) return null;

  const updateLine = (idx: number, field: "invoiceQty" | "invoiceUnitPriceRials", value: string) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], [field]: value };
    setLines(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!supplierRef.trim()) {
      setError("لطفاً شماره فاکتور تأمین‌کننده را وارد کنید.");
      return;
    }

    const activeLines = lines.filter((l) => {
      const q = parseDecimalToScaledBigInt(l.invoiceQty, 2);
      return q !== null && q > 0n;
    });
    if (activeLines.length === 0) {
      setError("حداقل یک قلم کالا با مقدار بیشتر از صفر باید انتخاب شود.");
      return;
    }

    const payloadLines: Array<{ receiptLineId: string; quantity: string; unitPrice: string }> = [];
    for (const l of activeLines) {
      const qtyHundredths = parseDecimalToScaledBigInt(l.invoiceQty, 2);
      const priceMinor = parseDecimalToScaledBigInt(l.invoiceUnitPriceRials, 2);
      if (qtyHundredths === null || qtyHundredths <= 0n || priceMinor === null) {
        setError(`مقدار یا قیمت واحد برای کالای ${l.sku} نامعتبر است.`);
        return;
      }
      payloadLines.push({
        receiptLineId: l.receiptLineId,
        quantity: qtyHundredths.toString(),
        unitPrice: priceMinor.toString(),
      });
    }

    let vatMinor: string | undefined;
    if (vatRials.trim()) {
      const parsedVat = parseDecimalToScaledBigInt(vatRials, 2);
      if (parsedVat === null) {
        setError("مبلغ مالیات بر ارزش افزوده نامعتبر است.");
        return;
      }
      vatMinor = parsedVat.toString();
    }

    setSubmitting(true);
    try {
      const res = await createSupplierInvoice(order.id, {
        supplierRef: supplierRef.trim(),
        invoiceDate: invoiceDate.trim(),
        vat: vatMinor,
        lines: payloadLines,
      });

      onSuccess(res);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در ثبت صورتحساب خرید.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`ثبت صورتحساب خرید برای سفارش ${order.number}`}
      description={`تأمین‌کننده: ${order.supplierCode} | تطبیق ۳-طرفه خودکار با سفارش و رسید انبار`}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" data-testid="invoice-create-form">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-supplier-ref">شماره فاکتور خود تأمین‌کننده *</Label>
            <Input
              id="inv-supplier-ref"
              placeholder="مثال: INV-2026-904"
              value={supplierRef}
              onChange={(e) => setSupplierRef(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-date">تاریخ فاکتور (YYYY-MM-DD) *</Label>
            <Input
              id="inv-date"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-vat">مالیات بر ارزش افزوده (ریال)</Label>
            <Input
              id="inv-vat"
              type="number"
              min="0"
              placeholder="اختیاری"
              value={vatRials}
              onChange={(e) => setVatRials(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-sm font-semibold">اقلام رسیدشده جهت تطبیق</Label>
          {loadingReceipts ? (
            <p className="text-xs text-muted-foreground">در حال بارگذاری رسیدهای انبار...</p>
          ) : lines.length === 0 ? (
            <p className="text-xs text-muted-foreground p-4 text-center border border-dashed rounded-lg">
              هیچ رسید کالایی برای این سفارش یافت نشد.
            </p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">کد کالا (SKU)</TableHead>
                    <TableHead className="text-center">مقدار رسید انبار</TableHead>
                    <TableHead className="text-center">بهای سفارش (ریال)</TableHead>
                    <TableHead className="w-36 text-center">مقدار صورتحساب *</TableHead>
                    <TableHead className="w-40 text-center">قیمت واحد صورتحساب (ریال) *</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, idx) => (
                    <TableRow key={l.receiptLineId}>
                      <TableCell className="font-medium">{l.sku}</TableCell>
                      <TableCell className="text-center tabular-nums">
                        {formatQuantity(l.receivedQuantity)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {formatMinorMoney(l.unitCost)}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.invoiceQty}
                          onChange={(e) => updateLine(idx, "invoiceQty", e.target.value)}
                          className="text-center tabular-nums"
                          aria-label={`مقدار صورتحساب برای ${l.sku}`}
                          required
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          value={l.invoiceUnitPriceRials}
                          onChange={(e) => updateLine(idx, "invoiceUnitPriceRials", e.target.value)}
                          className="text-center tabular-nums"
                          aria-label={`قیمت واحد صورتحساب برای ${l.sku}`}
                          required
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            انصراف
          </Button>
          <Button
            type="submit"
            disabled={submitting || lines.length === 0}
            className="min-w-36"
          >
            {submitting ? "در حال تطبیق و ثبت..." : "تطبیق و ثبت صورتحساب"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
