"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import { SkuInput } from "@/components/inventory/sku-input";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiClientError } from "@/lib/api/http-client";
import { listWarehouses } from "@/lib/api/inventory-client";
import { createPosSale } from "@/lib/api/invoicing-client";
import { formatMoneyRial } from "@/lib/fa-format";
import type { StockItem, Warehouse } from "@/types/inventory";
import {
  PAYMENT_METHOD_LABELS,
  VAT_RATE,
  type PaymentMethod,
  type PosSaleResponse,
} from "@/types/invoicing";

interface QuickSaleDrawerProps {
  open: boolean;
  defaultVatRate?: number;
  onClose: () => void;
  onSold: (result: PosSaleResponse) => void;
}

interface LineState {
  uid: number;
  code: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";

function newKey(): string {
  return `pos-${crypto.randomUUID()}`;
}

/**
 * Counter sale: the customer is optional (nothing, a phone, or a name and phone), items are
 * entered by code or barcode, and the sale is paid and posted in one step. The request carries
 * an idempotency key that stays the same across retries of this form, so a double click or a
 * dropped connection cannot create the sale twice.
 */
export function QuickSaleDrawer({
  open,
  defaultVatRate = VAT_RATE,
  onClose,
  onSold,
}: QuickSaleDrawerProps) {
  const nextUid = useRef(2);
  const keyRef = useRef(newKey());
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [lines, setLines] = useState<LineState[]>([
    { uid: 1, code: "", description: "", quantity: "1", unitPrice: "" },
  ]);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [cardAmount, setCardAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [done, setDone] = useState<PosSaleResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    listWarehouses(controller.signal)
      .then((list) => setWarehouses(list.filter((w) => w.isActive)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [open]);

  function updateLine(uid: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }

  function applyItem(uid: number, item: StockItem | null) {
    if (item) updateLine(uid, { description: item.name });
  }

  const valid = lines.filter(
    (l) => (l.code.trim() || l.description.trim()) && Number(l.quantity) > 0 && Number(l.unitPrice) > 0,
  );
  const net = valid.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);
  // Estimate only: the server computes the exact payable with each line's VAT and rounds it.
  const estimate = Math.round(net * (1 + defaultVatRate));

  function reset() {
    setPhone("");
    setName("");
    setLines([{ uid: nextUid.current++, code: "", description: "", quantity: "1", unitPrice: "" }]);
    setCardAmount("");
    setMethod("CASH");
    setErrors(null);
    keyRef.current = newKey();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (valid.length === 0) {
      setErrors(["حداقل یک سطر با کد یا شرح، تعداد و قیمت لازم است."]);
      return;
    }
    const card = Number(cardAmount) || 0;
    if (card < 0 || card > estimate) {
      setErrors(["مبلغ کارتخوان نامعتبر است."]);
      return;
    }
    const payments =
      card > 0 && card < estimate
        ? [
            { method: "CARD" as PaymentMethod, amount: card },
            { method, amount: estimate - card },
          ]
        : [{ method: card > 0 ? ("CARD" as PaymentMethod) : method, amount: estimate }];

    setBusy(true);
    setErrors(null);
    try {
      const result = await createPosSale({
        idempotencyKey: keyRef.current,
        customer: phone.trim() || name.trim() ? { phone: phone.trim() || undefined, name: name.trim() || undefined } : undefined,
        lines: valid.map((l) => ({
          code: l.code.trim() || undefined,
          description: l.description.trim() || undefined,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
        })),
        payments,
        warehouseId: warehouseId ? Number(warehouseId) : undefined,
      });
      setDone(result);
      onSold(result);
      reset();
    } catch (error) {
      setErrors(
        error instanceof ApiClientError
          ? error.details
          : ["ارتباط با سرور برقرار نشد؛ دوباره «ثبت فروش» را بزنید، فروش تکراری ثبت نمی‌شود."],
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      size="lg"
      title="فروش سریع"
      description="مشتری اختیاری است. کالا را با کد یا بارکد وارد کنید؛ پرداخت، حسابداری و انبار خودکار ثبت می‌شود."
      onClose={onClose}
    >
      <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
        {done && (
          <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            فروش {done.invoice.taxInvoiceNumber} ثبت شد
            {done.customerLevel === "anonymous" ? " (مشتری گذری)" : ""}.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="qs-phone">تلفن مشتری (اختیاری)</Label>
            <Input id="qs-phone" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="qs-name">نام مشتری (اختیاری)</Label>
            <Input id="qs-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>

        <div className="grid gap-2">
          {lines.map((line) => (
            <div key={line.uid} className="grid grid-cols-[1fr_5rem_8rem_auto] items-center gap-2">
              <div className="grid gap-1">
                <SkuInput
                  value={line.code}
                  onChange={(code) => updateLine(line.uid, { code })}
                  onResolved={(item) => applyItem(line.uid, item)}
                />
                {line.description && (
                  <span className="text-xs text-muted-foreground">{line.description}</span>
                )}
              </div>
              <Input
                dir="ltr"
                inputMode="decimal"
                aria-label="تعداد"
                placeholder="تعداد"
                value={line.quantity}
                onChange={(e) => updateLine(line.uid, { quantity: e.target.value })}
              />
              <Input
                dir="ltr"
                inputMode="decimal"
                aria-label="قیمت واحد"
                placeholder="قیمت واحد"
                value={line.unitPrice}
                onChange={(e) => updateLine(line.uid, { unitPrice: e.target.value })}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="حذف سطر"
                disabled={lines.length === 1}
                onClick={() => setLines((prev) => prev.filter((l) => l.uid !== line.uid))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() =>
              setLines((prev) => [
                ...prev,
                { uid: nextUid.current++, code: "", description: "", quantity: "1", unitPrice: "" },
              ])
            }
          >
            <Plus /> سطر جدید
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="qs-wh">انبار</Label>
            <select id="qs-wh" className={SELECT_CLASS} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">همهٔ انبارها</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="qs-method">روش پرداخت</Label>
            <select id="qs-method" className={SELECT_CLASS} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="qs-card">بخشی از مبلغ با کارتخوان</Label>
            <Input id="qs-card" dir="ltr" inputMode="decimal" value={cardAmount} onChange={(e) => setCardAmount(e.target.value)} placeholder="۰" />
          </div>
        </div>

        <p className="text-sm">
          مبلغ تقریبی قابل پرداخت (با مالیات): <strong>{formatMoneyRial(estimate)}</strong>
          <span className="block text-xs text-muted-foreground">
            مبلغ دقیق را سرور حساب می‌کند؛ اگر با پرداخت‌ها نخواند خطا می‌دهد.
          </span>
        </p>

        {errors && errors.length > 0 && (
          <ul className="list-disc space-y-1 ps-5 text-sm text-destructive" role="alert">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "در حال ثبت…" : "ثبت فروش"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            بستن
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
