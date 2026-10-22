"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CirclePlus,
  Loader2,
  Trash2,
  WandSparkles,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createInvoice, updateInvoice } from "@/lib/api/invoicing-client";
import { listLeads } from "@/lib/api/crm-client";
import { listStockItems } from "@/lib/api/inventory-client";
import { ApiClientError } from "@/lib/api/http-client";
import { formatMoneyRial } from "@/lib/fa-format";
import type { Lead } from "@/types/crm";
import type { StockItem } from "@/types/inventory";
import {
  INVOICE_STATUS_LABELS,
  InvoiceStatus,
  VAT_RATE,
  type CreateInvoiceDto,
  type InvoicePartyInfo,
  type InvoiceResponseDto,
} from "@/types/invoicing";

interface InvoiceEditorProps {
  invoice?: InvoiceResponseDto | null;
  defaultVatRate?: number;
  onSaved: (invoice: InvoiceResponseDto) => void;
  onCancel: () => void;
}

interface LineState {
  uid: string;
  itemId: string;
  sku: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  /** نرخ مالیات این سطر به درصد (مثلاً ۱۰). */
  vatRate: string;
}

interface PartyState {
  name: string;
  nationalId: string;
  economicCode: string;
  address: string;
  phone: string;
  email: string;
}

const EMPTY_PARTY: PartyState = {
  name: "",
  nationalId: "",
  economicCode: "",
  address: "",
  phone: "",
  email: "",
};

function createLine(uid: string, vatRate = VAT_RATE * 100): LineState {
  return {
    uid,
    itemId: "",
    sku: "",
    description: "",
    quantity: "1",
    unitPrice: "",
    discount: "0",
    vatRate: String(vatRate),
  };
}

function partyFromInfo(info?: InvoicePartyInfo): PartyState {
  return {
    name: info?.name ?? "",
    nationalId: info?.nationalId ?? "",
    economicCode: info?.economicCode ?? "",
    address: info?.address ?? "",
    phone: info?.phone ?? "",
    email: info?.email ?? "",
  };
}

function toPartyInfo(party: PartyState): InvoicePartyInfo {
  const info: InvoicePartyInfo = { name: party.name.trim() };
  if (party.nationalId.trim()) info.nationalId = party.nationalId.trim();
  if (party.economicCode.trim()) info.economicCode = party.economicCode.trim();
  if (party.address.trim()) info.address = party.address.trim();
  if (party.phone.trim()) info.phone = party.phone.trim();
  if (party.email.trim()) info.email = party.email.trim();
  return info;
}

function vatRateRatio(value: string): number {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0) return 0;
  return percent / 100;
}

function computeLine(line: LineState) {
  const quantity = Number(line.quantity) || 0;
  const unitPrice = Number(line.unitPrice) || 0;
  const discount = Number(line.discount) || 0;
  const gross = quantity * unitPrice;
  const taxable = Math.max(0, gross - discount);
  const tax = taxable * vatRateRatio(line.vatRate);
  return { gross, discount, taxable, tax, total: taxable + tax };
}

function makeInvoiceNumber(): string {
  const serial = String(Date.now()).slice(-8);
  return `TI-${serial}`;
}

/**
 * فرم ایجاد/ویرایش صورتحساب در نرم‌افزار `/app/invoicing`.
 * مشتری از CRM، کالاهای سطر از انبار و نرخ VAT هر سطر قابل انتخاب است؛
 * جمع‌بندی نهایی در سمت سرور دوباره محاسبه می‌شود.
 */
export function InvoiceEditor({
  invoice,
  defaultVatRate,
  onSaved,
  onCancel,
}: InvoiceEditorProps) {
  const nextLine = useRef(1);
  const isEdit = Boolean(invoice);
  const fallbackPercent = (defaultVatRate ?? VAT_RATE) * 100;

  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState(
    invoice?.taxInvoiceNumber ?? makeInvoiceNumber(),
  );
  const [status, setStatus] = useState<InvoiceStatus>(
    invoice && invoice.status !== InvoiceStatus.PAID
      ? invoice.status
      : InvoiceStatus.DRAFT,
  );
  const [customerId, setCustomerId] = useState(
    invoice?.customerId ? String(invoice.customerId) : "",
  );
  const [seller, setSeller] = useState<PartyState>(
    partyFromInfo(invoice?.sellerInfo),
  );
  const [buyer, setBuyer] = useState<PartyState>(
    partyFromInfo(invoice?.buyerInfo),
  );
  const [lines, setLines] = useState<LineState[]>(() => {
    if (invoice?.items?.length) {
      return invoice.items.map((item, index) => ({
        uid: `line-${index}`,
        itemId: item.itemId ? String(item.itemId) : "",
        sku: item.sku ?? "",
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
        discount: String(item.discount ?? 0),
        vatRate: String(Number(item.vatRate ?? defaultVatRate ?? VAT_RATE) * 100),
      }));
    }
    return [createLine("line-0", fallbackPercent)];
  });

  const [leads, setLeads] = useState<Lead[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listLeads({ page: 1, limit: 200 }, controller.signal),
      listStockItems({ page: 1, limit: 100 }, controller.signal),
    ])
      .then(([leadResult, itemResult]) => {
        setLeads(leadResult.data);
        setStockItems(itemResult.data);
      })
      .catch(() => {
        // Picker data is optional; the invoice can still be written by hand.
      });
    return () => controller.abort();
  }, []);

  function updateLine(uid: string, field: keyof LineState, value: string) {
    setLines((prev) =>
      prev.map((line) =>
        line.uid === uid ? { ...line, [field]: value } : line,
      ),
    );
  }

  function applyStockItem(uid: string, itemId: string) {
    const selected = stockItems.find((item) => String(item.id) === itemId);
    setLines((prev) =>
      prev.map((line) => {
        if (line.uid !== uid) return line;
        if (!selected) {
          return { ...line, itemId: "", sku: "" };
        }
        return {
          ...line,
          itemId: String(selected.id),
          sku: selected.sku,
          description: selected.name,
        };
      }),
    );
  }

  function applyCustomer(value: string) {
    setCustomerId(value);
    const lead = leads.find((item) => String(item.id) === value);
    if (!lead) return;
    setBuyer((prev) => ({
      ...prev,
      name: lead.company?.trim() || lead.fullName,
      phone: lead.phone ?? "",
      email: lead.email,
    }));
  }

  function addLine() {
    const id = nextLine.current++;
    setLines((prev) => [...prev, createLine(`line-${id}`, fallbackPercent)]);
  }

  function removeLine(uid: string) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((line) => line.uid !== uid) : prev,
    );
  }

  const totals = lines.reduce(
    (acc, line) => {
      const computed = computeLine(line);
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
    const messages: string[] = [];
    if (!taxInvoiceNumber.trim()) {
      messages.push("شماره صورتحساب الزامی است.");
    }
    if (!seller.name.trim()) {
      messages.push("نام فروشنده الزامی است.");
    }
    if (!buyer.name.trim()) {
      messages.push("نام خریدار الزامی است.");
    }
    const validLines = lines.filter(
      (line) =>
        line.description.trim() &&
        Number(line.quantity) > 0 &&
        Number(line.unitPrice) > 0,
    );
    if (validLines.length === 0) {
      messages.push("حداقل یک سطر با شرح، تعداد و قیمت واحد معتبر لازم است.");
    }
    for (const line of lines) {
      const rate = Number(line.vatRate);
      if (line.vatRate.trim() && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
        messages.push("نرخ مالیات هر سطر باید بین ۰ تا ۱۰۰ درصد باشد.");
        break;
      }
    }
    return messages;
  }

  async function submit() {
    setErrors(null);
    setSuccessMessage(null);
    const validationErrors = validate();
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    const payload: CreateInvoiceDto = {
      taxInvoiceNumber: taxInvoiceNumber.trim(),
      sellerInfo: toPartyInfo(seller),
      buyerInfo: toPartyInfo(buyer),
      customerId: customerId ? Number(customerId) : undefined,
      items: lines
        .filter((line) => line.description.trim())
        .map((line) => ({
          itemId: line.itemId ? Number(line.itemId) : undefined,
          sku: line.sku || undefined,
          description: line.description.trim(),
          quantity: Number(line.quantity) || 0,
          unitPrice: Number(line.unitPrice) || 0,
          discount: Number(line.discount) || 0,
          vatRate: vatRateRatio(line.vatRate),
        })),
      status,
    };

    setIsSubmitting(true);
    try {
      const saved = isEdit
        ? await updateInvoice(invoice!.id, payload)
        : await createInvoice(payload);
      setSuccessMessage(
        `صورتحساب ${saved.taxInvoiceNumber} با موفقیت ${isEdit ? "ویرایش" : "ایجاد"} شد.`,
      );
      onSaved(saved);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isEdit ? "ویرایش صورتحساب" : "صدور صورتحساب جدید"}
        </CardTitle>
        <CardDescription>
          مشتری را از CRM و کالاهای هر سطر را از انبار انتخاب کنید؛ نرخ VAT هر
          سطر جداگانه قابل تغییر است و جمع نهایی در سرور محاسبه می‌شود.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="invoice-number">شماره صورتحساب</Label>
              <div className="flex gap-2">
                <Input
                  id="invoice-number"
                  value={taxInvoiceNumber}
                  onChange={(event) => setTaxInvoiceNumber(event.target.value)}
                  maxLength={64}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="تولید شماره خودکار"
                  onClick={() => setTaxInvoiceNumber(makeInvoiceNumber())}
                >
                  <WandSparkles />
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="invoice-customer">مشتری (CRM)</Label>
              <select
                id="invoice-customer"
                value={customerId}
                onChange={(event) => applyCustomer(event.target.value)}
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              >
                <option value="">انتخاب از مشتریان CRM</option>
                {leads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.fullName}
                    {lead.company ? ` — ${lead.company}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="invoice-status">وضعیت</Label>
              <select
                id="invoice-status"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as InvoiceStatus)
                }
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              >
                <option value={InvoiceStatus.DRAFT}>
                  {INVOICE_STATUS_LABELS[InvoiceStatus.DRAFT]}
                </option>
                <option value={InvoiceStatus.ISSUED}>
                  {INVOICE_STATUS_LABELS[InvoiceStatus.ISSUED]}
                </option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold">اطلاعات فروشنده</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>نام / عنوان</Label>
                  <Input
                    value={seller.name}
                    onChange={(event) =>
                      setSeller({ ...seller, name: event.target.value })
                    }
                    placeholder="نام فروشنده"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>کد ملی / شناسه</Label>
                  <Input
                    value={seller.nationalId}
                    onChange={(event) =>
                      setSeller({ ...seller, nationalId: event.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>کد اقتصادی</Label>
                  <Input
                    value={seller.economicCode}
                    onChange={(event) =>
                      setSeller({ ...seller, economicCode: event.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>نشانی</Label>
                  <Input
                    value={seller.address}
                    onChange={(event) =>
                      setSeller({ ...seller, address: event.target.value })
                    }
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3 rounded-lg border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold">اطلاعات خریدار</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>نام / عنوان</Label>
                  <Input
                    value={buyer.name}
                    onChange={(event) =>
                      setBuyer({ ...buyer, name: event.target.value })
                    }
                    placeholder="نام خریدار"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>کد ملی / شناسه</Label>
                  <Input
                    value={buyer.nationalId}
                    onChange={(event) =>
                      setBuyer({ ...buyer, nationalId: event.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>کد اقتصادی</Label>
                  <Input
                    value={buyer.economicCode}
                    onChange={(event) =>
                      setBuyer({ ...buyer, economicCode: event.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>نشانی</Label>
                  <Input
                    value={buyer.address}
                    onChange={(event) =>
                      setBuyer({ ...buyer, address: event.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>تلفن</Label>
                  <Input
                    dir="ltr"
                    value={buyer.phone}
                    onChange={(event) =>
                      setBuyer({ ...buyer, phone: event.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>رایانامه</Label>
                  <Input
                    dir="ltr"
                    value={buyer.email}
                    onChange={(event) =>
                      setBuyer({ ...buyer, email: event.target.value })
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">اقلام صورتحساب</h3>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <CirclePlus />
                افزودن سطر
              </Button>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-40">کالای انبار</TableHead>
                    <TableHead className="min-w-48">شرح</TableHead>
                    <TableHead className="w-24">تعداد</TableHead>
                    <TableHead className="w-32">قیمت واحد (ریال)</TableHead>
                    <TableHead className="w-28">تخفیف</TableHead>
                    <TableHead className="w-24">VAT ٪</TableHead>
                    <TableHead className="w-32">مالیات</TableHead>
                    <TableHead className="w-36">جمع سطر</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const computed = computeLine(line);
                    return (
                      <TableRow key={line.uid}>
                        <TableCell>
                          <select
                            value={line.itemId}
                            onChange={(event) =>
                              applyStockItem(line.uid, event.target.value)
                            }
                            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
                            aria-label="انتخاب کالای انبار"
                          >
                            <option value="">کالا/خدمت دستی</option>
                            {stockItems.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} ({item.sku})
                              </option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={line.description}
                            onChange={(event) =>
                              updateLine(
                                line.uid,
                                "description",
                                event.target.value,
                              )
                            }
                            placeholder="شرح کالا یا خدمت"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            inputMode="decimal"
                            value={line.quantity}
                            onChange={(event) =>
                              updateLine(line.uid, "quantity", event.target.value)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            inputMode="decimal"
                            value={line.unitPrice}
                            onChange={(event) =>
                              updateLine(line.uid, "unitPrice", event.target.value)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            inputMode="decimal"
                            value={line.discount}
                            onChange={(event) =>
                              updateLine(line.uid, "discount", event.target.value)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            inputMode="decimal"
                            value={line.vatRate}
                            onChange={(event) =>
                              updateLine(line.uid, "vatRate", event.target.value)
                            }
                            aria-label="نرخ مالیات سطر"
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatMoneyRial(computed.tax)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm font-medium">
                          {formatMoneyRial(computed.total)}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={lines.length === 1}
                            onClick={() => removeLine(line.uid)}
                            title="حذف سطر"
                          >
                            <Trash2 />
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
              <span className="font-medium">{formatMoneyRial(totals.gross)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">جمع تخفیف</span>
              <span className="font-medium">
                {formatMoneyRial(totals.discount)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">جمع مالیات ارزش افزوده</span>
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {formatMoneyRial(totals.tax)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">قابل پرداخت</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {formatMoneyRial(totals.total)}
              </span>
            </div>
          </div>

          {errors && (
            <Alert variant="destructive">
              <AlertTitle>خطا در ثبت صورتحساب</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {successMessage && (
            <Alert>
              <CheckCircle2 className="size-4 text-emerald-500" />
              <AlertTitle>ذخیره شد</AlertTitle>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" />
                  در حال ذخیره...
                </>
              ) : (
                <>{isEdit ? "ذخیره تغییرات" : "صدور صورتحساب"}</>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              انصراف
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
