"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Ban,
  CheckCircle2,
  Eye,
  Pencil,
  Plus,
  ReceiptText,
  Search,
} from "lucide-react";

import {
  EmptyImportState,
  ErrorNotice,
  LoadingLine,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { InvoiceEditor } from "@/components/invoicing/invoice-editor";
import { InvoicePrintView } from "@/components/invoicing/invoice-print-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  cancelInvoice,
  listInvoices,
  payInvoice,
} from "@/lib/api/invoicing-client";
import { getMyTenant } from "@/lib/api/tenants-client";
import {
  formatGregorianDate,
  formatJalaliDate,
  formatLatinMoney,
  formatMoneyRial,
  formatNumber,
} from "@/lib/fa-format";
import {
  INVOICE_STATUS_LABELS,
  InvoiceStatus,
  VAT_RATE,
  invoiceRialEquivalent,
  isForeignInvoice,
  type InvoiceResponseDto,
} from "@/types/invoicing";

const PAGE_SIZE = 20;

function statusVariant(
  status: InvoiceStatus,
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case InvoiceStatus.PAID:
      return "default";
    case InvoiceStatus.ISSUED:
      return "outline";
    case InvoiceStatus.CANCELLED:
      return "destructive";
    default:
      return "secondary";
  }
}

export default function SuiteInvoicingPage() {
  return (
    <Suspense fallback={null}>
      <InvoicingPage />
    </Suspense>
  );
}

function InvoicingPage() {
  const searchParams = useSearchParams();
  const [invoices, setInvoices] = useState<InvoiceResponseDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<InvoiceStatus | "">("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [defaultVatRate, setDefaultVatRate] = useState(VAT_RATE);

  const [showEditor, setShowEditor] = useState(searchParams.get("new") === "1");
  const [editing, setEditing] = useState<InvoiceResponseDto | null>(null);
  const [viewing, setViewing] = useState<InvoiceResponseDto | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    listInvoices(
      {
        page,
        limit: PAGE_SIZE,
        status: status || undefined,
        search: search || undefined,
      },
      controller.signal,
    )
      .then((result) => {
        setInvoices(result.data);
        setTotal(result.total);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(loadErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, status, search, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    getMyTenant(controller.signal)
      .then((tenant) => {
        if (tenant.defaultVatRate !== undefined) {
          setDefaultVatRate(tenant.defaultVatRate);
        }
      })
      .catch(() => {
        // Keep the 10% platform default when the setting is unavailable.
      });
    return () => controller.abort();
  }, []);

  async function handlePay(invoice: InvoiceResponseDto) {
    setActionId(invoice.id);
    setError(null);
    try {
      const updated = await payInvoice(invoice.id);
      setViewing((current) =>
        current && current.id === updated.id ? updated : current,
      );
      refresh();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setActionId(null);
    }
  }

  async function handleCancel(invoice: InvoiceResponseDto) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`از ابطال صورتحساب ${invoice.taxInvoiceNumber} مطمئن هستید؟`)
    ) {
      return;
    }
    setActionId(invoice.id);
    setError(null);
    try {
      const updated = await cancelInvoice(invoice.id);
      setViewing((current) =>
        current && current.id === updated.id ? updated : current,
      );
      refresh();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setActionId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isEmpty = !loading && !error && total === 0 && !search && !status;

  return (
    <>
      <PageHeader
        title="صورتحساب‌ها"
        description="صدور و ویرایش فاکتور با مالیات ارزش افزوده، چاپ A4 و ثبت پرداخت"
        icon={<ReceiptText className="size-6 text-indigo-500" />}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setShowEditor(true);
            }}
          >
            <Plus />
            صورتحساب جدید
          </Button>
        }
      />

      <ErrorNotice title="خطا در عملیات صورتحساب" message={error} />

      {showEditor && (
        <InvoiceEditor
          invoice={editing}
          defaultVatRate={defaultVatRate}
          onSaved={() => {
            setShowEditor(false);
            setEditing(null);
            refresh();
          }}
          onCancel={() => {
            setShowEditor(false);
            setEditing(null);
          }}
        />
      )}

      {isEmpty ? (
        <EmptyImportState
          title="فایل اکسل فاکتورهای قبلی‌تان را اینجا رها کنید"
          hint="برای ورود خودکار صورتحساب‌ها به صفحه ورود داده بروید"
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1 sm:max-w-sm">
                <Search className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="جست‌وجوی شماره صورتحساب یا نام خریدار"
                  className="pr-8"
                  aria-label="جست‌وجوی صورتحساب"
                />
              </div>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as InvoiceStatus | "");
                  setPage(1);
                }}
                aria-label="فیلتر وضعیت"
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              >
                <option value="">همه وضعیت‌ها</option>
                <option value={InvoiceStatus.DRAFT}>
                  {INVOICE_STATUS_LABELS[InvoiceStatus.DRAFT]}
                </option>
                <option value={InvoiceStatus.ISSUED}>
                  {INVOICE_STATUS_LABELS[InvoiceStatus.ISSUED]}
                </option>
                <option value={InvoiceStatus.PAID}>
                  {INVOICE_STATUS_LABELS[InvoiceStatus.PAID]}
                </option>
                <option value={InvoiceStatus.CANCELLED}>
                  {INVOICE_STATUS_LABELS[InvoiceStatus.CANCELLED]}
                </option>
              </select>
              <LoadingLine show={loading} />
            </div>
            <span className="text-xs text-muted-foreground">
              {formatNumber(total)} صورتحساب
            </span>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>شماره</TableHead>
                  <TableHead>خریدار</TableHead>
                  <TableHead>تاریخ</TableHead>
                  <TableHead>جمع ناخالص</TableHead>
                  <TableHead>مالیات</TableHead>
                  <TableHead>قابل پرداخت</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead className="w-64">عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && invoices.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-muted-foreground"
                    >
                      در حال بارگذاری...
                    </TableCell>
                  </TableRow>
                ) : invoices.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-muted-foreground"
                    >
                      صورتحسابی با این فیلتر یافت نشد.
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.map((invoice) => {
                    const busy = actionId === invoice.id;
                    const canChange =
                      invoice.status !== InvoiceStatus.PAID &&
                      invoice.status !== InvoiceStatus.CANCELLED;
                    const foreign = isForeignInvoice(invoice);
                    const money = (value: number) =>
                      foreign
                        ? formatLatinMoney(value, invoice.currency)
                        : formatMoneyRial(value);
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {invoice.taxInvoiceNumber}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {invoice.buyerInfo?.name ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {foreign
                            ? formatGregorianDate(invoice.createdAt)
                            : formatJalaliDate(invoice.createdAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {money(invoice.totalAmount)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-amber-600 dark:text-amber-400">
                          {money(invoice.totalTax)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-medium text-emerald-600 dark:text-emerald-400">
                          {money(invoice.finalPayable)}
                          {foreign && (
                            <span className="block text-[11px] font-normal text-muted-foreground">
                              ≈ {formatMoneyRial(invoiceRialEquivalent(invoice))}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(invoice.status)}>
                            {INVOICE_STATUS_LABELS[invoice.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setViewing(invoice)}
                              title="مشاهده و چاپ"
                            >
                              <Eye />
                              مشاهده
                            </Button>
                            {canChange && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => {
                                    setEditing(invoice);
                                    setShowEditor(true);
                                  }}
                                  title="ویرایش"
                                >
                                  <Pencil />
                                  ویرایش
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => void handlePay(invoice)}
                                  title="ثبت پرداخت"
                                >
                                  <CheckCircle2 />
                                  پرداخت
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => void handleCancel(invoice)}
                                  title="ابطال"
                                >
                                  <Ban />
                                  ابطال
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-2 border-t border-border p-3 text-xs text-muted-foreground">
                <span>
                  صفحه {formatNumber(page)} از {formatNumber(pageCount)}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    قبلی
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pageCount}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    بعدی
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {viewing && (
        <InvoicePrintView
          invoice={viewing}
          onClose={() => setViewing(null)}
          onPay={(invoice) => void handlePay(invoice)}
          onEdit={(invoice) => {
            setViewing(null);
            setEditing(invoice);
            setShowEditor(true);
          }}
        />
      )}
    </>
  );
}
