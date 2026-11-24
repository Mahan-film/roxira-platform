"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createLandedCost } from "@/lib/api/purchasing-client";
import { formatMinorMoney, parseDecimalToScaledBigInt } from "./purchasing-format";
import type { GoodsReceipt, LandedCost, LandedCostBasis, LandedCostCategory } from "@/types/purchasing";

interface LandedCostDrawerProps {
  receipt: GoodsReceipt | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (landedCost: LandedCost) => void;
}

const CATEGORIES: { id: LandedCostCategory; label: string }[] = [
  { id: "FREIGHT", label: "حمل و نقل و ترانزیت (FREIGHT)" },
  { id: "CUSTOMS", label: "حقوق و عوارض گمرکی (CUSTOMS)" },
  { id: "INSURANCE", label: "بیمه باربری (INSURANCE)" },
  { id: "OTHER", label: "سایر هزینه‌های سربار (OTHER)" },
];

const BASES: { id: LandedCostBasis; label: string }[] = [
  { id: "VALUE", label: "بر مبنای ارزش ریالی کالاها (VALUE)" },
  { id: "QUANTITY", label: "بر مبنای مقدار / تعداد اقلام (QUANTITY)" },
  { id: "WEIGHT", label: "بر مبنای وزن کالاها (WEIGHT)" },
];

export function LandedCostDrawer({
  receipt,
  open,
  onClose,
  onSuccess,
}: LandedCostDrawerProps) {
  const today = new Date().toISOString().split("T")[0];
  const [category, setCategory] = useState<LandedCostCategory>("FREIGHT");
  const [basis, setBasis] = useState<LandedCostBasis>("VALUE");
  const [amountRials, setAmountRials] = useState("");
  const [date, setDate] = useState(today);
  const [supplierCode, setSupplierCode] = useState(receipt?.supplierCode ?? "");
  const [reference, setReference] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!receipt) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedMinor = parseDecimalToScaledBigInt(amountRials, 2);
    if (parsedMinor === null || parsedMinor <= 0n) {
      setError("لطفاً مبلغ هزینه سربار را به درستی وارد کنید.");
      return;
    }

    if (!supplierCode.trim()) {
      setError("کد طرف‌حساب هزینه را وارد کنید.");
      return;
    }

    if (!reference.trim()) {
      setError("شماره بارنامه یا ارجاع هزینه الزامی است.");
      return;
    }

    setSubmitting(true);
    try {
      const minorAmount = parsedMinor.toString();
      const res = await createLandedCost(receipt.id, {
        category,
        basis,
        amount: minorAmount,
        date: date.trim(),
        supplierCode: supplierCode.trim(),
        reference: reference.trim(),
        idempotencyKey: idempotencyKey.trim() || undefined,
      });

      onSuccess(res);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در تخصیص هزینه سربار خرید.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`تخصیص هزینه سربار به رسید ${receipt.number}`}
      description="هزینه حمل، گمرک یا بیمه را بر مبنای ارزش، مقدار یا وزن بین سطرهای رسید سرشکن کنید."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" data-testid="landed-cost-form">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lc-category">نوع هزینه سربار *</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as LandedCostCategory)}>
              <SelectTrigger id="lc-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lc-basis">مبنای سرشکن کردن *</Label>
            <Select value={basis} onValueChange={(v) => setBasis(v as LandedCostBasis)}>
              <SelectTrigger id="lc-basis">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASES.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lc-amount">مبلغ هزینه سربار (ریال) *</Label>
            <Input
              id="lc-amount"
              type="number"
              min="1"
              placeholder="مثال: 15000000"
              value={amountRials}
              onChange={(e) => setAmountRials(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lc-date">تاریخ هزینه (YYYY-MM-DD) *</Label>
            <Input
              id="lc-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lc-supplier">کد طرف‌حساب / پیمانکار هزینه *</Label>
            <Input
              id="lc-supplier"
              placeholder="مثال: CARRIER-01"
              value={supplierCode}
              onChange={(e) => setSupplierCode(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lc-reference">شماره بارنامه / سند ارجاع *</Label>
            <Input
              id="lc-reference"
              placeholder="مثال: BL-98432"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lc-idempotency">شناسه یکتای تکرارناپذیری (اختیاری)</Label>
          <Input
            id="lc-idempotency"
            placeholder="مثال: lc-rcpt-01"
            value={idempotencyKey}
            onChange={(e) => setIdempotencyKey(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            انصراف
          </Button>
          <Button type="submit" disabled={submitting} className="min-w-32">
            {submitting ? "در حال ثبت..." : "ثبت و تخصیص سربار"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
