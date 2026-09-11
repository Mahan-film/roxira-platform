"use client";

import { useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2Icon,
  Loader2Icon,
  PackagePlus,
  SendHorizonalIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { issueStock, receiveStock } from "@/lib/api/inventory-client";
import { ApiClientError } from "@/lib/api/http-client";
import { formatPersianDate, formatRial } from "@/lib/format";
import {
  STOCK_MOVEMENT_TYPE_LABELS,
  StockMovementType,
  type StockItem,
  type StockMovementResult,
  type Warehouse,
} from "@/types/inventory";

interface StockMovementFormProps {
  items: StockItem[];
  warehouses: Warehouse[];
  onCompleted?: (result: StockMovementResult) => void;
}

const NO_WAREHOUSE = "none";

/**
 * فرم ثبت گردش انبار (ورود/خروج کالا) با قیمت‌گذاری FIFO.
 *
 * - ورود کالا: ثبت بهای خرید واحد و ایجاد لایه FIFO جدید.
 * - خروج کالا: مصرف قدیمی‌ترین لایه‌ها و محاسبه بهای تمام‌شده.
 * - خروجی شامل ردیابی تفصیلی لایه‌های مصرف‌شده است.
 */
export function StockMovementForm({
  items,
  warehouses,
  onCompleted,
}: StockMovementFormProps) {
  const [mode, setMode] = useState<StockMovementType>(
    StockMovementType.INBOUND,
  );
  const [sku, setSku] = useState("");
  const [warehouseId, setWarehouseId] = useState<string>(NO_WAREHOUSE);
  const [quantity, setQuantity] = useState("");
  const [unitPurchaseCost, setUnitPurchaseCost] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [reference, setReference] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [result, setResult] = useState<StockMovementResult | null>(null);

  function selectMode(next: StockMovementType) {
    setMode(next);
    setErrors(null);
    setResult(null);
  }

  function validate(): string[] {
    const messages: string[] = [];
    if (!sku) messages.push("انتخاب کالا الزامی است.");
    const quantityValue = Number(quantity);
    if (!quantity.trim() || Number.isNaN(quantityValue) || quantityValue <= 0) {
      messages.push("مقدار باید عددی بزرگ‌تر از صفر باشد.");
    }
    if (mode === StockMovementType.INBOUND) {
      const costValue = Number(unitPurchaseCost);
      if (
        !unitPurchaseCost.trim() ||
        Number.isNaN(costValue) ||
        costValue <= 0
      ) {
        messages.push("بهای خرید واحد برای ورود کالا الزامی است.");
      }
    }
    return messages;
  }

  async function submit() {
    setErrors(null);
    setResult(null);

    const validationErrors = validate();
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const parsedWarehouseId =
        warehouseId === NO_WAREHOUSE ? undefined : Number(warehouseId);

      const movement =
        mode === StockMovementType.INBOUND
          ? await receiveStock({
              sku,
              quantity: Number(quantity),
              unitPurchaseCost: Number(unitPurchaseCost),
              warehouseId: parsedWarehouseId,
              batchNumber: batchNumber.trim() || undefined,
              reference: reference.trim() || undefined,
            })
          : await issueStock({
              sku,
              quantity: Number(quantity),
              warehouseId: parsedWarehouseId,
              reference: reference.trim() || undefined,
            });

      setResult(movement);
      setQuantity("");
      setUnitPurchaseCost("");
      setBatchNumber("");
      setReference("");
      onCompleted?.(movement);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(error.details);
      } else {
        setErrors([
          "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.",
        ]);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  const isInbound = mode === StockMovementType.INBOUND;

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <PackagePlus className="size-4 text-indigo-500" />
              ثبت گردش انبار
            </CardTitle>
            <CardDescription className="mt-1">
              ورود کالا با ایجاد لایه FIFO و خروج کالا با مصرف قدیمی‌ترین لایه‌ها.
            </CardDescription>
          </div>
          <div className="flex rounded-lg border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={isInbound ? "default" : "ghost"}
              onClick={() => selectMode(StockMovementType.INBOUND)}
            >
              <ArrowDownToLine />
              ورود
            </Button>
            <Button
              type="button"
              size="sm"
              variant={!isInbound ? "default" : "ghost"}
              onClick={() => selectMode(StockMovementType.OUTBOUND)}
            >
              <ArrowUpFromLine />
              خروج
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>کالا</Label>
              <Select<string>
                value={sku || null}
                onValueChange={(value) => setSku(value ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="انتخاب کالا" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.id} value={item.sku}>
                      {item.sku} — {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>انبار</Label>
              <Select<string>
                value={warehouseId}
                onValueChange={(value) =>
                  setWarehouseId(value ?? NO_WAREHOUSE)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="انتخاب انبار" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_WAREHOUSE}>
                    بدون انبار مشخص (همه انبارها)
                  </SelectItem>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                      {warehouse.name} ({warehouse.locationCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>مقدار</Label>
              <Input
                inputMode="decimal"
                value={quantity}
                placeholder="0"
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>

            {isInbound && (
              <div className="grid gap-2">
                <Label>بهای خرید واحد (ریال)</Label>
                <Input
                  inputMode="decimal"
                  value={unitPurchaseCost}
                  placeholder="0"
                  onChange={(event) => setUnitPurchaseCost(event.target.value)}
                />
              </div>
            )}

            {isInbound && (
              <div className="grid gap-2">
                <Label>شماره دسته (اختیاری)</Label>
                <Input
                  value={batchNumber}
                  placeholder="در صورت خالی بودن خودکار تولید می‌شود"
                  onChange={(event) => setBatchNumber(event.target.value)}
                  maxLength={100}
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label>شرح / مرجع</Label>
              <Input
                value={reference}
                placeholder={isInbound ? "خرید از تأمین‌کننده" : "فروش به مشتری"}
                onChange={(event) => setReference(event.target.value)}
                maxLength={512}
              />
            </div>
          </div>

          {errors && (
            <Alert variant="destructive">
              <AlertTitle>خطا در ثبت گردش انبار</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert>
              <CheckCircle2Icon className="size-4 text-emerald-500" />
              <AlertTitle>
                {STOCK_MOVEMENT_TYPE_LABELS[result.type]} با موفقیت ثبت شد
              </AlertTitle>
              <AlertDescription>
                کالای {result.sku} — موجودی پس از عملیات{" "}
                {result.quantityAfter.toLocaleString("fa-IR")} — ارزش گردش{" "}
                {formatRial(result.totalCost)}
              </AlertDescription>
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
                <SendHorizonalIcon />
                {isInbound ? "ثبت ورود کالا" : "ثبت خروج کالا"}
              </>
            )}
          </Button>
        </form>

        {result && result.layers.length > 0 && (
          <div className="mt-5 flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              ردیابی لایه‌های FIFO ({result.layers.length} لایه)
            </h3>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-40">شماره دسته</TableHead>
                    <TableHead className="w-28">مقدار</TableHead>
                    <TableHead className="w-40">بهای واحد</TableHead>
                    <TableHead className="w-40">ارزش لایه</TableHead>
                    <TableHead className="w-28">انبار</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.layers.map((layer) => (
                    <TableRow key={`${layer.batchId}-${layer.batchNumber}`}>
                      <TableCell className="font-mono text-xs">
                        {layer.batchNumber}
                      </TableCell>
                      <TableCell>
                        {layer.quantity.toLocaleString("fa-IR")}
                      </TableCell>
                      <TableCell>{formatRial(layer.unitPurchaseCost)}</TableCell>
                      <TableCell>{formatRial(layer.value)}</TableCell>
                      <TableCell>
                        {layer.warehouseId !== null ? (
                          <Badge variant="outline">
                            {warehouses.find(
                              (w) => w.id === layer.warehouseId,
                            )?.name ?? layer.warehouseId}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              زمان پردازش: {formatPersianDate(result.processedAt)}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
