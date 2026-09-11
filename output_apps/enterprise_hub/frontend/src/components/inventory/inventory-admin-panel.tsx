"use client";

import { useState, type FormEvent } from "react";
import {
  Boxes,
  CheckCircle2Icon,
  Loader2Icon,
  PlusCircle,
  Warehouse,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createStockItem,
  createWarehouse,
} from "@/lib/api/inventory-client";
import { ApiClientError } from "@/lib/api/http-client";

interface InventoryAdminPanelProps {
  onChanged?: () => void;
}

type PanelMode = "item" | "warehouse";

/**
 * پنل مدیریت پایه انبار: افزودن کالای جدید و تعریف انبار جدید.
 */
export function InventoryAdminPanel({ onChanged }: InventoryAdminPanelProps) {
  const [mode, setMode] = useState<PanelMode>("item");

  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [name, setName] = useState("");
  const [minQuantity, setMinQuantity] = useState("");

  const [warehouseName, setWarehouseName] = useState("");
  const [locationCode, setLocationCode] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function switchMode(next: PanelMode) {
    setMode(next);
    setErrors(null);
    setSuccess(null);
  }

  async function submitItem() {
    const messages: string[] = [];
    if (!sku.trim()) messages.push("شناسه کالا (SKU) الزامی است.");
    if (!barcode.trim()) messages.push("بارکد کالا الزامی است.");
    if (name.trim().length < 2) messages.push("نام کالا باید حداقل ۲ نویسه باشد.");
    if (messages.length > 0) {
      setErrors(messages);
      return;
    }

    setIsSubmitting(true);
    setSuccess(null);
    try {
      const created = await createStockItem({
        sku: sku.trim(),
        barcode: barcode.trim(),
        name: name.trim(),
        minQuantity: minQuantity.trim() ? Number(minQuantity) : 0,
      });
      setSuccess(`کالای ${created.sku} با موفقیت به فهرست انبار افزوده شد.`);
      setSku("");
      setBarcode("");
      setName("");
      setMinQuantity("");
      setErrors(null);
      onChanged?.();
    } catch (error) {
      setErrors(
        error instanceof ApiClientError
          ? error.details
          : ["ارتباط با سرور برقرار نشد."],
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitWarehouse() {
    const messages: string[] = [];
    if (warehouseName.trim().length < 2) messages.push("نام انبار الزامی است.");
    if (locationCode.trim().length < 2) messages.push("کد مکانی انبار الزامی است.");
    if (messages.length > 0) {
      setErrors(messages);
      return;
    }

    setIsSubmitting(true);
    setSuccess(null);
    try {
      const created = await createWarehouse({
        name: warehouseName.trim(),
        locationCode: locationCode.trim(),
      });
      setSuccess(`انبار ${created.name} با موفقیت ایجاد شد.`);
      setWarehouseName("");
      setLocationCode("");
      setErrors(null);
      onChanged?.();
    } catch (error) {
      setErrors(
        error instanceof ApiClientError
          ? error.details
          : ["ارتباط با سرور برقرار نشد."],
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void (mode === "item" ? submitItem() : submitWarehouse());
  }

  const isItem = mode === "item";

  return (
    <Card className="h-full border-0 bg-gradient-to-br from-violet-500/10 via-transparent to-transparent ring-1 ring-violet-500/20">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <PlusCircle className="size-4 text-violet-500" />
              مدیریت پایه انبار
            </CardTitle>
            <CardDescription className="mt-1">
              تعریف کالای جدید یا ایجاد انبار سازمانی.
            </CardDescription>
          </div>
          <div className="flex rounded-lg border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={isItem ? "default" : "ghost"}
              onClick={() => switchMode("item")}
            >
              <Boxes />
              کالا
            </Button>
            <Button
              type="button"
              size="sm"
              variant={!isItem ? "default" : "ghost"}
              onClick={() => switchMode("warehouse")}
            >
              <Warehouse />
              انبار
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {isItem ? (
            <>
              <div className="grid gap-2">
                <Label>شناسه کالا (SKU)</Label>
                <Input
                  value={sku}
                  onChange={(event) => setSku(event.target.value)}
                  placeholder="SKU-ROX-1001"
                  maxLength={64}
                />
              </div>
              <div className="grid gap-2">
                <Label>نام کالا</Label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="روتر سازمانی مدل RX-900"
                  maxLength={255}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>بارکد</Label>
                  <Input
                    value={barcode}
                    onChange={(event) => setBarcode(event.target.value)}
                    placeholder="6260001234567"
                    maxLength={128}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>حد کسری</Label>
                  <Input
                    inputMode="decimal"
                    value={minQuantity}
                    onChange={(event) => setMinQuantity(event.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-2">
                <Label>نام انبار</Label>
                <Input
                  value={warehouseName}
                  onChange={(event) => setWarehouseName(event.target.value)}
                  placeholder="انبار مرکزی تهران"
                  maxLength={100}
                />
              </div>
              <div className="grid gap-2">
                <Label>کد مکانی</Label>
                <Input
                  value={locationCode}
                  onChange={(event) => setLocationCode(event.target.value)}
                  placeholder="THR-CENTRAL-01"
                  maxLength={50}
                />
              </div>
            </>
          )}

          {errors && (
            <Alert variant="destructive">
              <AlertTitle>خطا در ثبت اطلاعات</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert>
              <CheckCircle2Icon className="size-4 text-emerald-500" />
              <AlertTitle>ثبت موفق</AlertTitle>
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={isSubmitting} className="self-start">
            {isSubmitting ? (
              <>
                <Loader2Icon className="animate-spin" />
                در حال ثبت...
              </>
            ) : (
              <>
                <PlusCircle />
                {isItem ? "افزودن کالا" : "ایجاد انبار"}
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
