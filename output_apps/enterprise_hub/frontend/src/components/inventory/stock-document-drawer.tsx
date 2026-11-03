"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import { SkuInput } from "@/components/inventory/sku-input";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiClientError } from "@/lib/api/http-client";
import {
  createAdjustment,
  createDelivery,
  createReceipt,
  listWarehouses,
} from "@/lib/api/inventory-client";
import type { Warehouse } from "@/types/inventory";

export type DocumentKind = "receipt" | "delivery" | "adjustment";

const COPY: Record<DocumentKind, { title: string; description: string; submit: string }> = {
  receipt: {
    title: "رسید خرید به انبار",
    description: "برای هر سطر یک لایهٔ FIFO با بهای واحد سند تأمین‌کننده ساخته می‌شود. بها را حدس نزنید؛ از فاکتور بخوانید.",
    submit: "ثبت رسید",
  },
  delivery: {
    title: "حوالهٔ خروج از انبار",
    description: "کالا با قدیمی‌ترین لایه‌های FIFO از انبار خارج می‌شود.",
    submit: "ثبت حواله",
  },
  adjustment: {
    title: "تعدیل موجودی (انبارگردانی)",
    description: "مقدار مثبت = اضافه (بها لازم است)، منفی = کسری. یک سند حسابداری هم ثبت می‌شود.",
    submit: "ثبت تعدیل",
  },
};

const SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";

interface Line {
  uid: number;
  sku: string;
  quantity: string;
  cost: string;
}

interface StockDocumentDrawerProps {
  kind: DocumentKind | null;
  onClose: () => void;
  onPosted: () => void;
}

/** Receipt, delivery and adjustment forms: one drawer, lines entered by code or barcode. */
export function StockDocumentDrawer({ kind, onClose, onPosted }: StockDocumentDrawerProps) {
  const nextUid = useRef(2);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [reference, setReference] = useState("");
  const [docDate, setDocDate] = useState("");
  const [lines, setLines] = useState<Line[]>([{ uid: 1, sku: "", quantity: "", cost: "" }]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);

  useEffect(() => {
    if (!kind) return;
    const controller = new AbortController();
    listWarehouses(controller.signal)
      .then((list) => setWarehouses(list.filter((w) => w.isActive)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [kind]);

  if (!kind) return null;
  const copy = COPY[kind];
  const needsCost = kind === "receipt" || kind === "adjustment";

  function update(uid: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const rows = lines.filter((l) => l.sku.trim() && Number(l.quantity) !== 0 && l.quantity.trim() !== "");
    const messages: string[] = [];
    if (!warehouseId) messages.push("انبار را انتخاب کنید.");
    if (rows.length === 0) messages.push("حداقل یک سطر با کد کالا و مقدار لازم است.");
    if (kind === "adjustment" && !reference.trim()) messages.push("علت تعدیل الزامی است.");
    for (const row of rows) {
      const quantity = Number(row.quantity);
      if (kind !== "adjustment" && quantity <= 0) messages.push(`مقدار کالای ${row.sku} باید مثبت باشد.`);
      if (needsCost && quantity > 0 && !(Number(row.cost) > 0)) messages.push(`بهای واحد کالای ${row.sku} را وارد کنید.`);
    }
    if (messages.length > 0) {
      setErrors(messages);
      return;
    }
    const base = { docDate: docDate || undefined };
    setBusy(true);
    setErrors(null);
    try {
      if (kind === "receipt") {
        await createReceipt({
          ...base,
          toWarehouseId: Number(warehouseId),
          reference: reference.trim() || undefined,
          lines: rows.map((r) => ({ sku: r.sku.trim(), quantity: Number(r.quantity), unitCost: Number(r.cost) })),
        });
      } else if (kind === "delivery") {
        await createDelivery({
          ...base,
          fromWarehouseId: Number(warehouseId),
          reference: reference.trim() || undefined,
          lines: rows.map((r) => ({ sku: r.sku.trim(), quantity: Number(r.quantity) })),
        });
      } else {
        await createAdjustment({
          ...base,
          warehouseId: Number(warehouseId),
          reason: reference.trim(),
          lines: rows.map((r) => ({
            sku: r.sku.trim(),
            quantity: Number(r.quantity),
            unitCost: Number(r.quantity) > 0 ? Number(r.cost) : undefined,
          })),
        });
      }
      setLines([{ uid: nextUid.current++, sku: "", quantity: "", cost: "" }]);
      setReference("");
      onPosted();
      onClose();
    } catch (error) {
      setErrors(error instanceof ApiClientError ? error.details : ["ارتباط با سرور برقرار نشد."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open size="lg" title={copy.title} description={copy.description} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="doc-wh">انبار</Label>
            <select id="doc-wh" className={SELECT_CLASS} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">انتخاب…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="doc-date">تاریخ سند (میلادی، اختیاری)</Label>
            <Input id="doc-date" dir="ltr" placeholder="2026-11-03" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="doc-ref">{kind === "adjustment" ? "علت تعدیل" : "مرجع (شمارهٔ فاکتور)"}</Label>
            <Input id="doc-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>

        <div className="grid gap-2">
          {lines.map((line) => (
            <div key={line.uid} className={`grid items-center gap-2 ${needsCost ? "grid-cols-[1fr_6rem_8rem_auto]" : "grid-cols-[1fr_8rem_auto]"}`}>
              <SkuInput value={line.sku} onChange={(sku) => update(line.uid, { sku })} />
              <Input dir="ltr" inputMode="decimal" aria-label="مقدار" placeholder="مقدار" value={line.quantity} onChange={(e) => update(line.uid, { quantity: e.target.value })} />
              {needsCost && (
                <Input dir="ltr" inputMode="decimal" aria-label="بهای واحد" placeholder="بهای واحد" value={line.cost} onChange={(e) => update(line.uid, { cost: e.target.value })} />
              )}
              <Button type="button" size="icon" variant="ghost" aria-label="حذف سطر" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((l) => l.uid !== line.uid))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setLines((prev) => [...prev, { uid: nextUid.current++, sku: "", quantity: "", cost: "" }])}>
            <Plus /> سطر جدید
          </Button>
        </div>

        {errors && (
          <ul className="list-disc space-y-1 ps-5 text-sm text-destructive" role="alert">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>{busy ? "در حال ثبت…" : copy.submit}</Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>انصراف</Button>
        </div>
      </form>
    </Drawer>
  );
}
