"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileSpreadsheet, Plus, ReceiptText, Search } from "lucide-react";

import {
  ErrorNotice,
  LoadingLine,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { EmptyState } from "@/components/app/empty-state";
import { InvoiceEditor } from "@/components/invoicing/invoice-editor";
import { QuickSaleDrawer } from "@/components/invoicing/quick-sale-drawer";
import { Drawer } from "@/components/ui/drawer";
import { InvoiceListTable } from "@/components/invoicing/invoice-list-table";
import { InvoicePrintView } from "@/components/invoicing/invoice-print-view";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  cancelInvoice,
  listInvoices,
  payInvoice,
} from "@/lib/api/invoicing-client";
import { getMyTenant } from "@/lib/api/tenants-client";
import { formatNumber } from "@/lib/fa-format";
import { toggleSelection } from "@/lib/invoice-list";
import {
  INVOICE_DIRECTION_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_SUBJECT_LABELS,
  InvoiceDirection,
  InvoiceStatus,
  InvoiceSubject,
  VAT_RATE,
  type InvoiceResponseDto,
} from "@/types/invoicing";

const PAGE_SIZE = 20;

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
  const [ownName, setOwnName] = useState("");
  const [direction, setDirection] = useState<InvoiceDirection>(
    searchParams.get("direction") === InvoiceDirection.PURCHASE
      ? InvoiceDirection.PURCHASE
      : InvoiceDirection.SALE,
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // What the drawer opens for: a new sale/purchase, or a corrective/cancel/return of `related`.
  const [newDirection, setNewDirection] = useState<InvoiceDirection>(
    InvoiceDirection.SALE,
  );
  const [newSubject, setNewSubject] = useState<InvoiceSubject>(
    InvoiceSubject.ORIGINAL,
  );
  const [related, setRelated] = useState<InvoiceResponseDto | null>(null);
  const [showQuickSale, setShowQuickSale] = useState(false);

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
        direction,
      },
      controller.signal,
    )
      .then((result) => {
        setInvoices(result.data);
        setSelected(new Set());
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
  }, [page, status, search, direction, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    getMyTenant(controller.signal)
      .then((tenant) => {
        if (tenant.defaultVatRate !== undefined) {
          setDefaultVatRate(tenant.defaultVatRate);
        }
        setOwnName(tenant.name ?? "");
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

  function openNew(
    nextDirection: InvoiceDirection,
    subject = InvoiceSubject.ORIGINAL,
    relatedInvoice: InvoiceResponseDto | null = null,
  ) {
    setEditing(null);
    setNewDirection(nextDirection);
    setNewSubject(subject);
    setRelated(relatedInvoice);
    setViewing(null);
    setShowEditor(true);
  }

  function closeEditor() {
    setShowEditor(false);
    setEditing(null);
    setRelated(null);
    setNewSubject(InvoiceSubject.ORIGINAL);
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
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => openNew(direction)}>
              <Plus />
              {direction === InvoiceDirection.PURCHASE ? "فاکتور خرید" : "فاکتور فروش"}
            </Button>
            {direction === InvoiceDirection.SALE && (
              <>
                <Button variant="outline" onClick={() => setShowQuickSale(true)}>
                  <Plus />
                  فروش سریع
                </Button>
                <Link href="/app/invoicing/pos">
                  <Button variant="outline">
                    پایانه فروش (POS)
                  </Button>
                </Link>
              </>
            )}
          </div>
        }
      />

      <ErrorNotice title="خطا در عملیات صورتحساب" message={error} />

      <QuickSaleDrawer
        open={showQuickSale}
        defaultVatRate={defaultVatRate}
        onClose={() => setShowQuickSale(false)}
        onSold={refresh}
      />

      <Drawer
        open={showEditor}
        size="xl"
        title={
          editing
            ? `ویرایش ${INVOICE_DIRECTION_LABELS[editing.direction]} ${editing.taxInvoiceNumber}`
            : newSubject !== InvoiceSubject.ORIGINAL
              ? `صورتحساب ${INVOICE_SUBJECT_LABELS[newSubject]}`
              : newDirection === InvoiceDirection.PURCHASE
                ? "ثبت فاکتور خرید"
                : "صدور فاکتور فروش"
        }
        description="مشتری یا تأمین‌کننده، کالای هر سطر و انبار را انتخاب کنید؛ مالیات هر سطر جدا قابل تنظیم است و جمع نهایی در سرور محاسبه و گرد می‌شود."
        onClose={closeEditor}
      >
        {showEditor && (
          <InvoiceEditor
            invoice={editing}
            direction={newDirection}
            subject={newSubject}
            related={related}
            ownName={ownName}
            defaultVatRate={defaultVatRate}
            onSaved={() => {
              closeEditor();
              refresh();
            }}
            onCancel={closeEditor}
          />
        )}
      </Drawer>

      <div role="tablist" aria-label="فروش یا خرید" className="flex gap-1 border-b border-border">
        {[InvoiceDirection.SALE, InvoiceDirection.PURCHASE].map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={direction === tab}
            onClick={() => {
              setDirection(tab);
              setPage(1);
            }}
            className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-medium ${
              direction === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {INVOICE_DIRECTION_LABELS[tab]}
          </button>
        ))}
      </div>

      {isEmpty ? (
        <EmptyState
          icon={<ReceiptText className="size-6 text-indigo-500" aria-hidden="true" />}
          description={
            direction === InvoiceDirection.PURCHASE
              ? "هنوز فاکتور خریدی ثبت نشده است. فاکتور خرید موجودی کالا و بدهی به تأمین‌کننده را ثبت می‌کند."
              : "هنوز فاکتور فروشی صادر نشده است. فاکتور فروش با مالیات ارزش افزوده و چاپ A4 از اینجا صادر می‌شود."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => openNew(direction)}>
                <Plus />
                {direction === InvoiceDirection.PURCHASE
                  ? "اولین فاکتور خرید را ثبت کنید"
                  : "اولین فاکتور فروش را بسازید"}
              </Button>
              <Link href="/app/import" className={buttonVariants({ variant: "outline" })}>
                <FileSpreadsheet />
                ورود از اکسل
              </Link>
            </div>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1 sm:max-w-sm">
                <Search className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="جست‌وجوی شماره صورتحساب یا نام خریدار"
                  className="ps-8"
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
            <InvoiceListTable
              invoices={invoices}
              loading={loading}
              busyId={actionId}
              selected={selected}
              onToggle={(id) =>
                setSelected((current) =>
                  toggleSelection(current, invoices.map((invoice) => invoice.id), id),
                )
              }
              onView={setViewing}
              onEdit={(invoice) => {
                setEditing(invoice);
                setShowEditor(true);
              }}
              onPay={(invoice) => void handlePay(invoice)}
              onCancel={(invoice) => void handleCancel(invoice)}
              onRelated={(invoice, subject) => openNew(invoice.direction, subject, invoice)}
            />
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
            setNewDirection(invoice.direction);
            setEditing(invoice);
            setShowEditor(true);
          }}
        />
      )}
    </>
  );
}
