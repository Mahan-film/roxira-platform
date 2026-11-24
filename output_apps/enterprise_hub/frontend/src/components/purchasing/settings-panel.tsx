"use client";

import { useEffect, useState } from "react";
import { Check, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPurchaseSettings, updatePurchaseSettings } from "@/lib/api/purchasing-client";
import { formatMinorMoney, parseDecimalToScaledBigInt } from "./purchasing-format";
import type { PurchaseSettings } from "@/types/purchasing";

interface SettingsPanelProps {
  canAdmin?: boolean;
}

export function SettingsPanel({ canAdmin = false }: SettingsPanelProps) {
  const [settings, setSettings] = useState<PurchaseSettings | null>(null);
  const [overBp, setOverBp] = useState("0");
  const [priceBp, setPriceBp] = useState("0");
  const [priceAbsRials, setPriceAbsRials] = useState("0");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; variant: "default" | "destructive" } | null>(null);

  useEffect(() => {
    getPurchaseSettings()
      .then((s) => {
        setSettings(s);
        setOverBp(s.overReceiptToleranceBp.toString());
        setPriceBp(s.priceToleranceBp.toString());
        // Abs minor -> rials
        const rials = (BigInt(s.priceToleranceAbs) / 100n).toString();
        setPriceAbsRials(rials);
      })
      .catch((err) => {
        setMessage({
          text: err instanceof Error ? err.message : "خطا در دریافت تنظیمات تحمل.",
          variant: "destructive",
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdmin) return;
    setMessage(null);
    setSubmitting(true);
    try {
      const minorAbs = (parseDecimalToScaledBigInt(priceAbsRials || "0", 2) ?? 0n).toString();
      const res = await updatePurchaseSettings({
        overReceiptToleranceBp: parseInt(overBp, 10) || 0,
        priceToleranceBp: parseInt(priceBp, 10) || 0,
        priceToleranceAbs: minorAbs,
      });
      setSettings(res);
      setMessage({ text: "تنظیمات تحمل چرخه خرید با موفقیت ذخیره شد.", variant: "default" });
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : "خطا در ذخیره تنظیمات.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        در حال بارگذاری تنظیمات...
      </div>
    );
  }

  return (
    <Card className="max-w-2xl mx-auto" data-testid="purchasing-settings-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Settings className="size-5 text-indigo-500" />
          تنظیمات آستانه تحمل (Tolerances) چرخه خرید
        </CardTitle>
        <CardDescription>
          در صورت بروز اختلاف بیش از این مقادیر در رسید کالا یا صورتحساب، سند جهت بررسی متوقف (HELD) می‌شود.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="flex flex-col gap-5">
          {message && (
            <Alert variant={message.variant}>
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="set-over-bp">
              آستانه تحمل اضافه‌دریافت کالا (بیس‌پوینت - هر ۱۰۰ بیس‌پوینت = ۱٪)
            </Label>
            <Input
              id="set-over-bp"
              type="number"
              min="0"
              max="10000"
              value={overBp}
              onChange={(e) => setOverBp(e.target.value)}
              disabled={!canAdmin || submitting}
              required
            />
            <p className="text-xs text-muted-foreground">
              معادل: {(parseInt(overBp, 10) / 100 || 0).toLocaleString("fa-IR")} درصد اضافه‌دریافت نسبت به سفارش
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="set-price-bp">
              آستانه تحمل درصدی اختلاف قیمت صورتحساب (بیس‌پوینت)
            </Label>
            <Input
              id="set-price-bp"
              type="number"
              min="0"
              max="10000"
              value={priceBp}
              onChange={(e) => setPriceBp(e.target.value)}
              disabled={!canAdmin || submitting}
              required
            />
            <p className="text-xs text-muted-foreground">
              معادل: {(parseInt(priceBp, 10) / 100 || 0).toLocaleString("fa-IR")} درصد تفاوت قیمت
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="set-price-abs">
              آستانه تحمل مطلق اختلاف قیمت هر سطر (ریال)
            </Label>
            <Input
              id="set-price-abs"
              type="number"
              min="0"
              value={priceAbsRials}
              onChange={(e) => setPriceAbsRials(e.target.value)}
              disabled={!canAdmin || submitting}
              required
            />
            <p className="text-xs text-muted-foreground">
              معادل: {formatMinorMoney((BigInt(priceAbsRials || "0") * 100n).toString())}
            </p>
          </div>

          {canAdmin ? (
            <div className="flex justify-end pt-3 border-t border-border">
              <Button type="submit" disabled={submitting} className="min-w-32 gap-1.5">
                <Check className="size-4" />
                {submitting ? "در حال ذخیره..." : "ذخیره تنظیمات"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground pt-2">
              برای ویرایش تنظیمات نیاز به دسترسی راهبر (ADMIN) در ماژول انبار دارید.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
