"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  listPriceTiers,
  createPriceTier,
  deletePriceTier,
} from "@/lib/api/sales-client";
import { formatSalesMoney, parseNonNegativeMinor } from "./sales-format";
import type { CustomerGroup, PriceTier } from "@/types/sales";

const CUSTOMER_GROUP_LABELS: Record<CustomerGroup, string> = {
  CONSUMER: "مشتری عادی (CONSUMER)",
  WHOLESALE: "عمده‌فروشی (WHOLESALE)",
  PARTNER: "همکار / شریک تجاری (PARTNER)",
};

export function PriceTiersTab() {
  const [tiers, setTiers] = useState<PriceTier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterSku, setFilterSku] = useState("");
  const [filterGroup, setFilterGroup] = useState<CustomerGroup | "">("");

  // Create form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [sku, setSku] = useState("");
  const [customerGroup, setCustomerGroup] = useState<CustomerGroup>("CONSUMER");
  const [unitPriceMinor, setUnitPriceMinor] = useState("");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchTiers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPriceTiers({
        sku: filterSku.trim() || undefined,
        customerGroup: filterGroup || undefined,
      });
      setTiers(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در دریافت لیست سطوح قیمت.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTiers();
  }, [filterGroup]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedSku = sku.trim();
    if (!trimmedSku) {
      setError("شناسه کالا / SKU الزامی است.");
      return;
    }

    const price = parseNonNegativeMinor(unitPriceMinor, false);
    if (price === null) {
      setError("مبلغ واحد نامعتبر است.");
      return;
    }

    const discountTrimmed = discountPercent.trim() || "0";
    if (!/^\d+(?:\.\d+)?$/.test(discountTrimmed)) {
      setError("درصد تخفیف نامعتبر است.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createPriceTier({
        sku: trimmedSku,
        customerGroup,
        unitPriceMinor: price,
        discountPercent: Number(discountTrimmed),
        effectiveFrom: effectiveFrom.trim() || undefined,
        effectiveTo: effectiveTo.trim() || undefined,
      });

      setTiers([created, ...tiers]);
      setShowAddForm(false);
      setSku("");
      setUnitPriceMinor("");
      setDiscountPercent("0");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در ثبت سطح قیمت جدید.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deletePriceTier(id);
      setTiers(tiers.filter((t) => t.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در حذف سطح قیمت.");
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="price-tiers-container">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Input
              placeholder="جستجو بر اساس SKU..."
              value={filterSku}
              onChange={(e) => setFilterSku(e.target.value)}
              className="h-9 w-48 text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={fetchTiers}
              className="gap-1.5 h-9"
            >
              <Filter className="size-3.5" />
              فیلتر
            </Button>
          </div>
          <select
            value={filterGroup}
            onChange={(e) => setFilterGroup(e.target.value as CustomerGroup | "")}
            className="h-9 rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="گروه مشتری"
          >
            <option value="">همه گروه‌های مشتری</option>
            <option value="CONSUMER">مشتری عادی</option>
            <option value="WHOLESALE">عمده‌فروشی</option>
            <option value="PARTNER">همکار / شریک</option>
          </select>
        </div>

        <Button
          size="sm"
          onClick={() => setShowAddForm(!showAddForm)}
          className="gap-1.5"
        >
          <Plus className="size-3.5" />
          افزودن سطح قیمت
        </Button>
      </div>

      {/* Add Price Tier Form */}
      {showAddForm && (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4"
        >
          <div className="text-sm font-semibold text-primary">
            ثبت سطح قیمت / تخفیف جدید
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pt-sku" className="text-xs">
                کد کالا / SKU *
              </Label>
              <Input
                id="pt-sku"
                placeholder="مثال: ITEM-101"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pt-group" className="text-xs">
                گروه مشتری *
              </Label>
              <select
                id="pt-group"
                value={customerGroup}
                onChange={(e) => setCustomerGroup(e.target.value as CustomerGroup)}
                className="h-9 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="CONSUMER">مشتری عادی (CONSUMER)</option>
                <option value="WHOLESALE">عمده‌فروشی (WHOLESALE)</option>
                <option value="PARTNER">همکار / شریک (PARTNER)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pt-price" className="text-xs">
                قیمت واحد (ریال) *
              </Label>
              <Input
                id="pt-price"
                type="number"
                min="0"
                value={unitPriceMinor}
                onChange={(e) => setUnitPriceMinor(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pt-disc" className="text-xs">
                درصد تخفیف (%)
              </Label>
              <Input
                id="pt-disc"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pt-from" className="text-xs">
                معتبر از تاریخ
              </Label>
              <Input
                id="pt-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pt-to" className="text-xs">
                معتبر تا تاریخ
              </Label>
              <Input
                id="pt-to"
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAddForm(false)}
              disabled={submitting}
            >
              انصراف
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? "در حال ثبت..." : "ثبت سطح قیمت"}
            </Button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-right text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2">شناسه کالا / SKU</th>
              <th className="px-3 py-2">گروه مشتری</th>
              <th className="px-3 py-2">قیمت واحد (ریال)</th>
              <th className="px-3 py-2 text-center">تخفیف</th>
              <th className="px-3 py-2 text-center">معتبر از</th>
              <th className="px-3 py-2 text-center">معتبر تا</th>
              <th className="px-3 py-2 text-center">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  در حال بارگذاری سطوح قیمت...
                </td>
              </tr>
            ) : tiers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  سطح قیمتی تعریف نشده است.
                </td>
              </tr>
            ) : (
              tiers.map((t) => (
                <tr key={t.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2.5 font-semibold">{t.sku}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {CUSTOMER_GROUP_LABELS[t.customerGroup] || t.customerGroup}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-primary">
                    {formatSalesMoney(t.unitPriceMinor)}
                  </td>
                  <td className="px-3 py-2.5 text-center font-medium">
                    {t.discountPercent > 0 ? `%${t.discountPercent}` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center text-muted-foreground">
                    {t.effectiveFrom || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center text-muted-foreground">
                    {t.effectiveTo || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(t.id)}
                      className="size-7 text-destructive hover:bg-destructive/10"
                      aria-label={`حذف سطح قیمت ${t.sku}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
