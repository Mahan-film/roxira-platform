"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiClientError } from "@/lib/api/http-client";
import { createStockItem } from "@/lib/api/inventory-client";

interface ItemCreateDrawerProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/** New item form. It makes the catalogue entry only; stock arrives through a receipt or the opening balance. */
export function ItemCreateDrawer({ open, onClose, onCreated }: ItemCreateDrawerProps) {
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [name, setName] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const messages: string[] = [];
    if (!sku.trim()) messages.push("کد کالا (SKU) الزامی است.");
    if (!barcode.trim()) messages.push("بارکد الزامی است (می‌توانید همان کد کالا را بگذارید).");
    if (name.trim().length < 2) messages.push("نام کالا باید حداقل ۲ نویسه باشد.");
    if (messages.length > 0) {
      setErrors(messages);
      return;
    }
    setBusy(true);
    setErrors(null);
    try {
      await createStockItem({
        sku: sku.trim(),
        barcode: barcode.trim(),
        name: name.trim(),
        minQuantity: minQuantity.trim() ? Number(minQuantity) : 0,
      });
      setSku("");
      setBarcode("");
      setName("");
      setMinQuantity("");
      onCreated();
      onClose();
    } catch (error) {
      setErrors(error instanceof ApiClientError ? error.details : ["ارتباط با سرور برقرار نشد."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      size="md"
      title="کالای جدید"
      description="کالا بدون موجودی ثبت می‌شود؛ موجودی را با رسید خرید یا موجودی اول دوره وارد کنید."
      onClose={onClose}
    >
      <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
        <div className="grid gap-2">
          <Label htmlFor="item-sku">کد کالا (SKU)</Label>
          <Input id="item-sku" dir="ltr" value={sku} onChange={(e) => setSku(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="item-barcode">بارکد</Label>
          <Input id="item-barcode" dir="ltr" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="item-name">نام کالا</Label>
          <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="item-min">حد کسری (اختیاری)</Label>
          <Input id="item-min" dir="ltr" inputMode="decimal" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} />
        </div>
        {errors && (
          <ul className="list-disc space-y-1 ps-5 text-sm text-destructive" role="alert">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>{busy ? "در حال ثبت…" : "افزودن کالا"}</Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>انصراف</Button>
        </div>
      </form>
    </Drawer>
  );
}
