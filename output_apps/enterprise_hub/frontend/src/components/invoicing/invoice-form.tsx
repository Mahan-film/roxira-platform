"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2Icon,
  CirclePlusIcon,
  Loader2Icon,
  SendHorizonalIcon,
  ShieldCheckIcon,
  Trash2Icon,
  WandSparklesIcon,
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

import { createInvoice } from "@/lib/api/invoicing-client";
import { ApiClientError } from "@/lib/api/http-client";
import { inferServiceDomain } from "@/lib/api/auth-client";
import { useAuth } from "@/components/auth/auth-provider";
import { formatRial } from "@/lib/format";
import {
  INVOICE_STATUS_LABELS,
  InvoiceStatus,
  VAT_RATE,
  type CreateInvoiceDto,
  type InvoicePartyInfo,
  type InvoiceResponseDto,
} from "@/types/invoicing";

interface FormItem {
  uid: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
}

interface PartyFormState {
  name: string;
  nationalId: string;
  economicCode: string;
  address: string;
}

interface ComputedItem {
  gross: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
}

interface InvoiceFormProps {
  onCreated?: (invoice: InvoiceResponseDto) => void;
}

const EMPTY_PARTY: PartyFormState = {
  name: "",
  nationalId: "",
  economicCode: "",
  address: "",
};

function createEmptyItem(uid: string): FormItem {
  return { uid, description: "", quantity: "1", unitPrice: "", discount: "0" };
}

function computeItem(item: FormItem): ComputedItem {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const discount = Number(item.discount) || 0;
  const gross = quantity * unitPrice;
  const taxable = Math.max(0, gross - discount);
  const tax = taxable * VAT_RATE;
  const total = taxable + tax;
  return { gross, discount, taxable, tax, total };
}

function toPartyInfo(party: PartyFormState): InvoicePartyInfo {
  const info: InvoicePartyInfo = { name: party.name.trim() };
  if (party.nationalId.trim()) info.nationalId = party.nationalId.trim();
  if (party.economicCode.trim()) info.economicCode = party.economicCode.trim();
  if (party.address.trim()) info.address = party.address.trim();
  return info;
}

function PartyFields({
  title,
  value,
  onChange,
}: {
  title: string;
  value: PartyFormState;
  onChange: (next: PartyFormState) => void;
}) {
  function update(field: keyof PartyFormState, fieldValue: string) {
    onChange({ ...value, [field]: fieldValue });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>نام / عنوان</Label>
          <Input
            value={value.name}
            onChange={(event) => update("name", event.target.value)}
            placeholder="شرکت پیشرو تجارت"
          />
        </div>
        <div className="grid gap-2">
          <Label>کد ملی / شناسه</Label>
          <Input
            value={value.nationalId}
            onChange={(event) => update("nationalId", event.target.value)}
            placeholder="14001234567"
          />
        </div>
        <div className="grid gap-2">
          <Label>کد اقتصادی</Label>
          <Input
            value={value.economicCode}
            onChange={(event) => update("economicCode", event.target.value)}
            placeholder="411234567890"
          />
        </div>
        <div className="grid gap-2">
          <Label>نشانی</Label>
          <Input
            value={value.address}
            onChange={(event) => update("address", event.target.value)}
            placeholder="تهران، خیابان ولیعصر"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * فرم صدور صورتحساب مالیاتی هوشمند.
 *
 * - اقلام کالا/خدمت به‌صورت داینامیک قابل افزودن/حذف هستند.
 * - مالیات ۹٪ و جمع هر سطر و جمع‌بندی نهایی به‌صورت آنی محاسبه و نمایش
 *   داده می‌شود (منبع نهایی، بازمحاسبه سرور است).
 * - متصل به `POST /enterprise-hub/invoicing` از طریق کلاینت تایپ‌سیف.
 */
export function InvoiceForm({ onCreated }: InvoiceFormProps) {
  const { isAuthenticated, openLogin } = useAuth();
  const nextItemId = useRef(1);
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState("");
  const [status, setStatus] = useState<InvoiceStatus>(InvoiceStatus.DRAFT);
  const [seller, setSeller] = useState<PartyFormState>(EMPTY_PARTY);
  const [buyer, setBuyer] = useState<PartyFormState>(EMPTY_PARTY);
  const [items, setItems] = useState<FormItem[]>([createEmptyItem("row-0")]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string[] | null>(null);
  const [createdInvoice, setCreatedInvoice] = useState<InvoiceResponseDto | null>(
    null,
  );

  function updateItem(uid: string, field: keyof FormItem, value: string) {
    setItems((prev) =>
      prev.map((item) => (item.uid === uid ? { ...item, [field]: value } : item)),
    );
  }

  function addItem() {
    const id = nextItemId.current++;
    setItems((prev) => [...prev, createEmptyItem(`row-${id}`)]);
  }

  function removeItem(uid: string) {
    setItems((prev) =>
      prev.length > 1 ? prev.filter((item) => item.uid !== uid) : prev,
    );
  }

  function generateTaxInvoiceNumber() {
    const now = new Date();
    const year = now.getFullYear();
    const serial = String(now.getTime()).slice(-6);
    setTaxInvoiceNumber(`TI-${year}-${serial}`);
  }

  const totals = items.reduce(
    (acc, item) => {
      const computed = computeItem(item);
      return {
        gross: acc.gross + computed.gross,
        discount: acc.discount + computed.discount,
        tax: acc.tax + computed.tax,
        total: acc.total + computed.total,
      };
    },
    { gross: 0, discount: 0, tax: 0, total: 0 },
  );

  function validate(): string[] {
    const errors: string[] = [];
    if (!taxInvoiceNumber.trim()) {
      errors.push("شماره صورتحساب مالیاتی الزامی است.");
    }
    if (!seller.name.trim()) {
      errors.push("نام فروشنده الزامی است.");
    }
    if (!buyer.name.trim()) {
      errors.push("نام خریدار الزامی است.");
    }
    const hasValidItem = items.some(
      (item) =>
        item.description.trim() &&
        Number(item.quantity) > 0 &&
        Number(item.unitPrice) > 0,
    );
    if (!hasValidItem) {
      errors.push("حداقل یک قلم کالا/خدمت با شرح، تعداد و قیمت واحد معتبر لازم است.");
    }
    return errors;
  }

  async function submitInvoice() {
    setSubmitError(null);
    setCreatedInvoice(null);

    const validationErrors = validate();
    if (validationErrors.length > 0) {
      setSubmitError(validationErrors);
      return;
    }

    // گیت احراز هویت: صدور فاکتور سازمانی نیازمند سشن معتبر پیامکی است.
    if (!isAuthenticated) {
      openLogin({
        serviceDomain: inferServiceDomain(),
        title: "ورود برای صدور فاکتور",
        description:
          "صدور صورتحساب سازمانی نیازمند احراز هویت است؛ شماره همراه خود را تأیید کنید.",
        onSuccess: () => {
          void submitInvoice();
        },
      });
      return;
    }

    const payload: CreateInvoiceDto = {
      taxInvoiceNumber: taxInvoiceNumber.trim(),
      sellerInfo: toPartyInfo(seller),
      buyerInfo: toPartyInfo(buyer),
      items: items
        .filter((item) => item.description.trim())
        .map((item) => ({
          description: item.description.trim(),
          quantity: Number(item.quantity) || 0,
          unitPrice: Number(item.unitPrice) || 0,
          discount: Number(item.discount) || 0,
        })),
      status,
    };

    setIsSubmitting(true);
    try {
      const result = await createInvoice(payload);
      setCreatedInvoice(result);
      setTaxInvoiceNumber("");
      setItems([createEmptyItem(`row-${nextItemId.current++}`)]);
      onCreated?.(result);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setSubmitError(error.details);
      } else {
        setSubmitError([
          "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.",
        ]);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitInvoice();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>صدور فاکتور هوشمند</CardTitle>
            <CardDescription className="mt-1">
              محاسبه آنی مالیات بر ارزش افزوده ۹٪ و جمع‌بندی خودکار مبالغ در سمت
              سرور.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-xs">
            VAT ۹٪
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>شماره صورتحساب مالیاتی</Label>
              <div className="flex gap-2">
                <Input
                  value={taxInvoiceNumber}
                  onChange={(event) => setTaxInvoiceNumber(event.target.value)}
                  placeholder="TI-1405-000123"
                  maxLength={64}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="تولید خودکار شماره"
                  onClick={generateTaxInvoiceNumber}
                >
                  <WandSparklesIcon />
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>وضعیت اولیه</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as InvoiceStatus)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={InvoiceStatus.DRAFT}>
                    {INVOICE_STATUS_LABELS[InvoiceStatus.DRAFT]}
                  </SelectItem>
                  <SelectItem value={InvoiceStatus.ISSUED}>
                    {INVOICE_STATUS_LABELS[InvoiceStatus.ISSUED]}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PartyFields title="اطلاعات فروشنده" value={seller} onChange={setSeller} />
            <PartyFields title="اطلاعات خریدار" value={buyer} onChange={setBuyer} />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">اقلام کالا / خدمت</h3>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <CirclePlusIcon />
                افزودن قلم
              </Button>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-48">شرح</TableHead>
                    <TableHead className="w-24">تعداد</TableHead>
                    <TableHead className="w-36">قیمت واحد</TableHead>
                    <TableHead className="w-32">تخفیف</TableHead>
                    <TableHead className="w-32">مالیات ۹٪</TableHead>
                    <TableHead className="w-36">جمع سطر</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const computed = computeItem(item);
                    return (
                      <TableRow key={item.uid}>
                        <TableCell>
                          <Input
                            value={item.description}
                            onChange={(event) =>
                              updateItem(item.uid, "description", event.target.value)
                            }
                            placeholder="شرح کالا یا خدمت"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            inputMode="decimal"
                            value={item.quantity}
                            onChange={(event) =>
                              updateItem(item.uid, "quantity", event.target.value)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            inputMode="decimal"
                            value={item.unitPrice}
                            onChange={(event) =>
                              updateItem(item.uid, "unitPrice", event.target.value)
                            }
                            placeholder="0"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            inputMode="decimal"
                            value={item.discount}
                            onChange={(event) =>
                              updateItem(item.uid, "discount", event.target.value)
                            }
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatRial(computed.tax)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm font-medium">
                          {formatRial(computed.total)}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeItem(item.uid)}
                            disabled={items.length === 1}
                            title="حذف قلم"
                          >
                            <Trash2Icon />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">جمع ناخالص</span>
              <span className="font-medium">{formatRial(totals.gross)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">جمع تخفیف</span>
              <span className="font-medium">{formatRial(totals.discount)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">جمع مالیات ۹٪</span>
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {formatRial(totals.tax)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">قابل پرداخت</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {formatRial(totals.total)}
              </span>
            </div>
          </div>

          {submitError && (
            <Alert variant="destructive">
              <AlertTitle>خطا در صدور صورتحساب</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {submitError.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {createdInvoice && (
            <Alert>
              <CheckCircle2Icon className="size-4 text-emerald-500" />
              <AlertTitle>صورتحساب با موفقیت ثبت شد</AlertTitle>
              <AlertDescription>
                شماره {createdInvoice.taxInvoiceNumber} — مبلغ نهایی قابل پرداخت:{" "}
                {formatRial(createdInvoice.finalPayable)}
              </AlertDescription>
            </Alert>
          )}

          {!isAuthenticated && (
            <Alert className="border-indigo-500/30 bg-indigo-500/5">
              <ShieldCheckIcon className="size-4 text-indigo-500" />
              <AlertTitle>احراز هویت لازم است</AlertTitle>
              <AlertDescription>
                برای صدور صورتحساب سازمانی، ابتدا با شماره همراه خود وارد شوید.
                با کلیک روی دکمه صدور، پنجره ورود پیامکی باز می‌شود.
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
                {isAuthenticated ? "صدور صورتحساب" : "ورود و صدور صورتحساب"}
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
