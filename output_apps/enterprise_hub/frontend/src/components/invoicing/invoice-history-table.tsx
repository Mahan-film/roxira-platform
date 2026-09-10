"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { BanIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { cancelInvoice, listInvoices } from "@/lib/api/invoicing-client";
import { ApiClientError } from "@/lib/api/http-client";
import { formatPersianDate, formatRial } from "@/lib/format";
import {
  INVOICE_STATUS_LABELS,
  InvoiceStatus,
  type PaginatedInvoiceResponse,
} from "@/types/invoicing";

const PAGE_SIZE = 10;
const ALL_STATUSES = "ALL" as const;

type StatusFilter = InvoiceStatus | typeof ALL_STATUSES;

function statusVariant(status: InvoiceStatus): "default" | "secondary" | "destructive" {
  switch (status) {
    case InvoiceStatus.ISSUED:
      return "default";
    case InvoiceStatus.CANCELLED:
      return "destructive";
    default:
      return "secondary";
  }
}

interface InvoiceHistoryTableProps {
  refreshKey?: number;
}

/**
 * جدول سوابق صورتحساب‌ها، متصل به `GET /enterprise-hub/invoicing`
 * (InvoicingController.findAll) و دارای عملیات ابطال
 * (`PATCH /enterprise-hub/invoicing/:id/cancel`).
 */
export function InvoiceHistoryTable({ refreshKey = 0 }: InvoiceHistoryTableProps) {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL_STATUSES);
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [response, setResponse] = useState<PaginatedInvoiceResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fetchRecords = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await listInvoices(
          {
            page,
            limit: PAGE_SIZE,
            status: statusFilter === ALL_STATUSES ? undefined : statusFilter,
            taxInvoiceNumber: taxInvoiceNumber || undefined,
          },
          signal,
        );
        setResponse(result);
        setErrorMessage(null);
      } catch (error) {
        if (error instanceof ApiClientError) {
          setErrorMessage(error.details.join(" | "));
        } else if (!(error instanceof DOMException)) {
          setErrorMessage(
            "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.",
          );
        }
      }
    },
    [page, statusFilter, taxInvoiceNumber],
  );

  const refresh = useCallback(
    (signal?: AbortSignal) => {
      startTransition(async () => {
        await fetchRecords(signal);
      });
    },
    [fetchRecords],
  );

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, refreshKey]);

  async function handleCancel(id: string, taxInvoiceNumber: string) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`از ابطال صورتحساب ${taxInvoiceNumber} مطمئن هستید؟`)
    ) {
      return;
    }

    setActionId(id);
    try {
      await cancelInvoice(id);
      refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorMessage(error.details.join(" | "));
      } else {
        setErrorMessage("ابطال صورتحساب ناموفق بود.");
      }
    } finally {
      setActionId(null);
    }
  }

  const isLoading = isPending;
  const totalPages = response
    ? Math.max(1, Math.ceil(response.total / response.limit))
    : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:max-w-xl">
          <form
            className="flex w-full items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setTaxInvoiceNumber(searchInput.trim());
            }}
          >
            <Input
              placeholder="جست‌وجوی شماره صورتحساب"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <Button type="submit" variant="outline" size="icon">
              <SearchIcon />
            </Button>
          </form>

          <Select<string>
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter((value ?? ALL_STATUSES) as StatusFilter);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>همه وضعیت‌ها</SelectItem>
              <SelectItem value={InvoiceStatus.DRAFT}>
                {INVOICE_STATUS_LABELS[InvoiceStatus.DRAFT]}
              </SelectItem>
              <SelectItem value={InvoiceStatus.ISSUED}>
                {INVOICE_STATUS_LABELS[InvoiceStatus.ISSUED]}
              </SelectItem>
              <SelectItem value={InvoiceStatus.CANCELLED}>
                {INVOICE_STATUS_LABELS[InvoiceStatus.CANCELLED]}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          variant="ghost"
          onClick={() => refresh()}
          disabled={isLoading}
        >
          <RefreshCwIcon className={isLoading ? "animate-spin" : undefined} />
          بروزرسانی
        </Button>
      </div>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>خطا در دریافت اطلاعات</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>شماره صورتحساب</TableHead>
              <TableHead>خریدار</TableHead>
              <TableHead>تاریخ ثبت</TableHead>
              <TableHead>جمع ناخالص</TableHead>
              <TableHead>تخفیف</TableHead>
              <TableHead>مالیات</TableHead>
              <TableHead>قابل پرداخت</TableHead>
              <TableHead>وضعیت</TableHead>
              <TableHead className="w-24">عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {Array.from({ length: 9 }).map((__, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : response && response.data.length > 0 ? (
              response.data.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {invoice.taxInvoiceNumber}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {invoice.buyerInfo?.name ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatPersianDate(invoice.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatRial(invoice.totalAmount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatRial(invoice.totalDiscount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-amber-600 dark:text-amber-400">
                    {formatRial(invoice.totalTax)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium text-emerald-600 dark:text-emerald-400">
                    {formatRial(invoice.finalPayable)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(invoice.status)}>
                      {INVOICE_STATUS_LABELS[invoice.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={
                        invoice.status === InvoiceStatus.CANCELLED ||
                        actionId === invoice.id
                      }
                      onClick={() =>
                        handleCancel(invoice.id, invoice.taxInvoiceNumber)
                      }
                    >
                      <BanIcon />
                      ابطال
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-10 text-center text-muted-foreground"
                >
                  هیچ صورتحسابی یافت نشد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {response ? `مجموع ${response.total.toLocaleString("fa-IR")} صورتحساب` : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isLoading}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            قبلی
          </Button>
          <span>
            صفحه {page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isLoading}
            onClick={() => setPage((prev) => prev + 1)}
          >
            بعدی
          </Button>
        </div>
      </div>
    </div>
  );
}
