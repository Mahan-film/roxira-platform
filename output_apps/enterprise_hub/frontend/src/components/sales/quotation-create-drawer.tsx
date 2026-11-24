"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createSalesQuotation } from "@/lib/api/sales-client";
import {
  computeLineTotalMinor,
  formatSalesMoney,
  parseNonNegativeMinor,
  parsePositiveDecimalString,
  parsePositiveInt,
} from "./sales-format";
import type { SalesQuotation } from "@/types/sales";

interface QuotationLineInputRow {
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
}

interface QuotationCreateDrawerProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (quotation: SalesQuotation) => void;
}

export function QuotationCreateDrawer({
  open,
  onClose,
  onSuccess,
}: QuotationCreateDrawerProps) {
  const today = new Date().toISOString().split("T")[0];
  const [partyCode, setPartyCode] = useState("");
  const [quoteDate, setQuoteDate] = useState(today);
  const [validUntil, setValidUntil] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<QuotationLineInputRow[]>([
    { itemId: "", description: "", quantity: "1", unitPrice: "0", discount: "0" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addLine = () => {
    setLines([
      ...lines,
      { itemId: "", description: "", quantity: "1", unitPrice: "0", discount: "0" },
    ]);
  };

  const removeLine = (idx: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: keyof QuotationLineInputRow, value: string) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], [field]: value };
    setLines(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedParty = partyCode.trim();
    if (!trimmedParty) {
      setError("لطفاً کد طرف‌حساب / مشتری را وارد کنید.");
      return;
    }

    if (lines.length === 0) {
      setError("حداقل یک سطر پیش‌فاکتور باید ثبت شود.");
      return;
    }

    const payloadLines: Array<{
      itemId: number;
      description?: string;
      quantity: string;
      unitPrice: string;
      discount: string;
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const itId = parsePositiveInt(l.itemId);
      if (itId === null) {
        setError(`شناسه کالای سطر ${i + 1} نامعتبر است.`);
        return;
      }
      const q = parsePositiveDecimalString(l.quantity);
      if (q === null) {
        setError(`مقدار سطر ${i + 1} باید بزرگتر از صفر باشد.`);
        return;
      }
      const p = parseNonNegativeMinor(l.unitPrice, false);
      if (p === null) {
        setError(`بهای واحد سطر ${i + 1} نامعتبر است.`);
        return;
      }
      const d = parseNonNegativeMinor(l.discount, true);
      if (d === null) {
        setError(`تخفیف سطر ${i + 1} نامعتبر است.`);
        return;
      }
      payloadLines.push({
        itemId: itId,
        description: l.description.trim() || undefined,
        quantity: q,
        unitPrice: p,
        discount: d,
      });
    }

    setSubmitting(true);
    try {

      const res = await createSalesQuotation({
        partyCode: trimmedParty,
        quoteDate: quoteDate.trim(),
        validUntil: validUntil.trim() || undefined,
        note: note.trim() || undefined,
        lines: payloadLines,
      });

      onSuccess(res);
      onClose();
      // Reset
      setPartyCode("");
      setNote("");
      setLines([{ itemId: "1", description: "", quantity: "1", unitPrice: "0", discount: "0" }]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در ثبت پیش‌فاکتور فروش.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="ثبت پیش‌فاکتور فروش جدید"
      description="پیش‌فاکتور فروش جدید را با اطلاعات مشتری، اعتبار و سطرهای پیشنهادی ثبت کنید."
      size="xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" data-testid="quotation-create-form">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quote-party-code">کد مشتری / طرف‌حساب *</Label>
            <Input
              id="quote-party-code"
              placeholder="مثال: CUST-01"
              value={partyCode}
              onChange={(e) => setPartyCode(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quote-date">تاریخ پیش‌فاکتور (YYYY-MM-DD) *</Label>
            <Input
              id="quote-date"
              type="date"
              value={quoteDate}
              onChange={(e) => setQuoteDate(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quote-valid-until">مهلت اعتبار (اختیاری)</Label>
            <Input
              id="quote-valid-until"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quote-note">یادداشت / شرایط پیش‌فاکتور</Label>
          <Input
            id="quote-note"
            placeholder="شرایط تسویه، حمل یا توضیحات..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">اقلام پیش‌فاکتور</Label>
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
            {lines.map((l, idx) => {
              const estTotal = computeLineTotalMinor(l.quantity, l.unitPrice, l.discount);

              return (
                <div
                  key={idx}
                  className="grid grid-cols-12 items-end gap-2.5 rounded-lg border border-border p-3 bg-muted/20"
                >
                  <div className="col-span-6 sm:col-span-2 flex flex-col gap-1">
                    <Label htmlFor={`quote-item-${idx}`} className="text-xs">
                      شناسه کالا *
                    </Label>
                    <Input
                      id={`quote-item-${idx}`}
                      type="number"
                      min="1"
                      value={l.itemId}
                      onChange={(e) => updateLine(idx, "itemId", e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3 flex flex-col gap-1">
                    <Label htmlFor={`quote-desc-${idx}`} className="text-xs">
                      شرح سطر
                    </Label>
                    <Input
                      id={`quote-desc-${idx}`}
                      placeholder="اختیاری"
                      value={l.description}
                      onChange={(e) => updateLine(idx, "description", e.target.value)}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2 flex flex-col gap-1">
                    <Label htmlFor={`quote-qty-${idx}`} className="text-xs">
                      مقدار *
                    </Label>
                    <Input
                      id={`quote-qty-${idx}`}
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={l.quantity}
                      onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2 flex flex-col gap-1">
                    <Label htmlFor={`quote-price-${idx}`} className="text-xs">
                      بهای واحد (ریال) *
                    </Label>
                    <Input
                      id={`quote-price-${idx}`}
                      type="number"
                      min="0"
                      value={l.unitPrice}
                      onChange={(e) => updateLine(idx, "unitPrice", e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2 flex flex-col gap-1">
                    <Label htmlFor={`quote-disc-${idx}`} className="text-xs">
                      تخفیف (ریال)
                    </Label>
                    <Input
                      id={`quote-disc-${idx}`}
                      type="number"
                      min="0"
                      value={l.discount}
                      onChange={(e) => updateLine(idx, "discount", e.target.value)}
                    />
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      جمع: {formatSalesMoney(estTotal)}
                    </span>
                  </div>
                  <div className="col-span-1 flex justify-end">
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
            {submitting ? "در حال ثبت..." : "ثبت پیش‌فاکتور"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
