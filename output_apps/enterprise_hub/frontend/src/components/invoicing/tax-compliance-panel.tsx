"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  BadgeCheckIcon,
  ClockIcon,
  DownloadIcon,
  KeyRoundIcon,
  PenLineIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
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

import { ApiClientError } from "@/lib/api/http-client";
import { listInvoices } from "@/lib/api/invoicing-client";
import {
  downloadTaxPacket,
  getActiveSigningKey,
  listTaxSignatures,
  signInvoice,
  submitTaxSignature,
  verifyTaxSignature,
} from "@/lib/api/tax-compliance-client";
import { formatPersianDate, formatRial } from "@/lib/format";
import type {
  InvoiceResponseDto,
  PaginatedInvoiceResponse,
} from "@/types/invoicing";
import {
  TAX_SUBMISSION_STATUS_LABELS,
  TaxSubmissionStatus,
  type SigningKeyResponseDto,
  type TaxSignatureResponseDto,
} from "@/types/tax-compliance";

const PAGE_SIZE = 10;
const ALL_STATUSES = "ALL" as const;
const SIGNATURES_LOOKUP_LIMIT = 100;

type TaxStatusFilter = TaxSubmissionStatus | typeof ALL_STATUSES;

function statusVariant(
  status: TaxSubmissionStatus,
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case TaxSubmissionStatus.ACCEPTED:
      return "default";
    case TaxSubmissionStatus.REJECTED:
      return "destructive";
    case TaxSubmissionStatus.SENT:
      return "outline";
    default:
      return "secondary";
  }
}

function extractError(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.details.join(" | ");
  }
  if (error instanceof DOMException) {
    return "درخواست لغو شد.";
  }
  return "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.";
}

interface TaxCompliancePanelProps {
  refreshKey?: number;
}

/**
 * پنل «سامانه مودیان» — نمایش وضعیت ارسال مالیاتی، کدهای مالیاتی ۲۲ رقمی
 * و دانلود بسته امضاشده. متصل به کنترلر
 * `/enterprise-hub/tax-compliance` در بک‌اند NestJS.
 */
export function TaxCompliancePanel({ refreshKey = 0 }: TaxCompliancePanelProps) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaxStatusFilter>(ALL_STATUSES);
  const [invoiceResponse, setInvoiceResponse] =
    useState<PaginatedInvoiceResponse | null>(null);
  const [signatureMap, setSignatureMap] = useState<
    Record<string, TaxSignatureResponseDto>
  >({});
  const [signingKey, setSigningKey] = useState<SigningKeyResponseDto | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [invoices, signatures, key] = await Promise.all([
          listInvoices(
            {
              page,
              limit: PAGE_SIZE,
              taxInvoiceNumber: committedSearch || undefined,
            },
            signal,
          ),
          listTaxSignatures(
            { page: 1, limit: SIGNATURES_LOOKUP_LIMIT },
            signal,
          ),
          getActiveSigningKey(signal).catch(() => null),
        ]);

        const map: Record<string, TaxSignatureResponseDto> = {};
        for (const signature of signatures.data) {
          map[signature.invoiceId] = signature;
        }

        setInvoiceResponse(invoices);
        setSignatureMap(map);
        setSigningKey(key);
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(extractError(error));
      }
    },
    [page, committedSearch],
  );

  const refresh = useCallback(
    (signal?: AbortSignal) => {
      startTransition(async () => {
        await fetchData(signal);
      });
    },
    [fetchData],
  );

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, refreshKey]);

  async function handleSign(invoice: InvoiceResponseDto) {
    setBusyKey(`${invoice.id}:sign`);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const detail = await signInvoice({ invoiceId: invoice.id });
      setSuccessMessage(
        `صورتحساب ${invoice.taxInvoiceNumber} امضا شد. کد مالیاتی: ${detail.taxId}`,
      );
      refresh();
    } catch (error) {
      setErrorMessage(extractError(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSubmit(signature: TaxSignatureResponseDto) {
    setBusyKey(`${signature.id}:submit`);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const detail = await submitTaxSignature(signature.id);
      setSuccessMessage(
        `بسته ${signature.taxInvoiceNumber} به سامانه مودیان ارسال و پذیرفته شد. شماره مرجع: ${detail.referenceNumber ?? "—"}`,
      );
      refresh();
    } catch (error) {
      setErrorMessage(extractError(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDownload(signature: TaxSignatureResponseDto) {
    setBusyKey(`${signature.id}:download`);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const packet = await downloadTaxPacket(signature.id);
      const blob = new Blob([JSON.stringify(packet, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `moadian-packet-${signature.taxId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setSuccessMessage(`بسته امضاشده ${signature.taxInvoiceNumber} دانلود شد.`);
    } catch (error) {
      setErrorMessage(extractError(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleVerify(signature: TaxSignatureResponseDto) {
    setBusyKey(`${signature.id}:verify`);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await verifyTaxSignature(signature.id);
      setSuccessMessage(
        result.valid
          ? `امضای دیجیتال بسته ${signature.taxInvoiceNumber} معتبر است (کلید ${result.keyId}).`
          : `امضای دیجیتال بسته ${signature.taxInvoiceNumber} نامعتبر است!`,
      );
    } catch (error) {
      setErrorMessage(extractError(error));
    } finally {
      setBusyKey(null);
    }
  }

  const filteredInvoices = useMemo(() => {
    const invoices = invoiceResponse?.data ?? [];
    return invoices.filter((invoice) => {
      if (statusFilter === ALL_STATUSES) {
        return true;
      }
      return signatureMap[invoice.id]?.status === statusFilter;
    });
  }, [invoiceResponse, signatureMap, statusFilter]);

  const stats = useMemo(() => {
    const values = Object.values(signatureMap);
    return {
      signed: values.filter((item) => item.status === TaxSubmissionStatus.SIGNED)
        .length,
      accepted: values.filter(
        (item) => item.status === TaxSubmissionStatus.ACCEPTED,
      ).length,
      rejected: values.filter(
        (item) => item.status === TaxSubmissionStatus.REJECTED,
      ).length,
    };
  }, [signatureMap]);

  const totalPages = invoiceResponse
    ? Math.max(1, Math.ceil(invoiceResponse.total / invoiceResponse.limit))
    : 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm">
          <CardHeader>
            <CardDescription>کل صورتحساب‌ها</CardDescription>
            <CardTitle className="text-2xl">
              {(invoiceResponse?.total ?? 0).toLocaleString("fa-IR")}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription className="flex items-center gap-1">
              <ClockIcon className="size-3.5" /> امضاشده (در انتظار ارسال)
            </CardDescription>
            <CardTitle className="text-2xl">
              {stats.signed.toLocaleString("fa-IR")}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription className="flex items-center gap-1">
              <BadgeCheckIcon className="size-3.5" /> پذیرفته‌شده توسط مودیان
            </CardDescription>
            <CardTitle className="text-2xl text-emerald-600 dark:text-emerald-400">
              {stats.accepted.toLocaleString("fa-IR")}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription className="flex items-center gap-1">
              <KeyRoundIcon className="size-3.5" /> کلید امضای فعال
            </CardDescription>
            <CardTitle className="truncate font-mono text-xs" dir="ltr">
              {signingKey?.keyId ?? "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            الگوریتم {signingKey?.algorithm ?? "RS256"} — طول{" "}
            {(signingKey?.modulusLength ?? 2048).toLocaleString("fa-IR")} بیت
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:max-w-xl">
          <form
            className="flex w-full items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setCommittedSearch(searchInput.trim());
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
              setStatusFilter((value ?? ALL_STATUSES) as TaxStatusFilter);
            }}
          >
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>همه وضعیت‌های مالیاتی</SelectItem>
              <SelectItem value={TaxSubmissionStatus.SIGNED}>
                {TAX_SUBMISSION_STATUS_LABELS[TaxSubmissionStatus.SIGNED]}
              </SelectItem>
              <SelectItem value={TaxSubmissionStatus.SENT}>
                {TAX_SUBMISSION_STATUS_LABELS[TaxSubmissionStatus.SENT]}
              </SelectItem>
              <SelectItem value={TaxSubmissionStatus.ACCEPTED}>
                {TAX_SUBMISSION_STATUS_LABELS[TaxSubmissionStatus.ACCEPTED]}
              </SelectItem>
              <SelectItem value={TaxSubmissionStatus.REJECTED}>
                {TAX_SUBMISSION_STATUS_LABELS[TaxSubmissionStatus.REJECTED]}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          variant="ghost"
          onClick={() => refresh()}
          disabled={isPending}
        >
          <RefreshCwIcon className={isPending ? "animate-spin" : undefined} />
          بروزرسانی
        </Button>
      </div>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>خطا در عملیات مالیاتی</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {successMessage && (
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>موفق</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>شماره صورتحساب</TableHead>
              <TableHead>خریدار</TableHead>
              <TableHead>مبلغ نهایی</TableHead>
              <TableHead>کد مالیاتی ۲۲ رقمی</TableHead>
              <TableHead>وضعیت ارسال</TableHead>
              <TableHead>تاریخ امضا</TableHead>
              <TableHead className="w-64">عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {Array.from({ length: 7 }).map((__, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filteredInvoices.length > 0 ? (
              filteredInvoices.map((invoice) => {
                const signature = signatureMap[invoice.id];
                const isBusy = busyKey?.startsWith(`${invoice.id}:`) ?? false;

                return (
                  <TableRow key={invoice.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {invoice.taxInvoiceNumber}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {invoice.buyerInfo?.name ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatRial(invoice.finalPayable)}
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap font-mono text-xs tracking-widest"
                      dir="ltr"
                    >
                      {signature?.taxId ?? "—"}
                    </TableCell>
                    <TableCell>
                      {signature ? (
                        <Badge variant={statusVariant(signature.status)}>
                          {TAX_SUBMISSION_STATUS_LABELS[signature.status]}
                        </Badge>
                      ) : (
                        <Badge variant="outline">امضانشده</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {signature ? formatPersianDate(signature.createdAt) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {!signature && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleSign(invoice)}
                          >
                            <PenLineIcon />
                            امضای الکترونیک
                          </Button>
                        )}

                        {signature && signature.status === TaxSubmissionStatus.SIGNED && (
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleSubmit(signature)}
                          >
                            <SendIcon />
                            ارسال به مودیان
                          </Button>
                        )}

                        {signature && (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => handleDownload(signature)}
                            >
                              <DownloadIcon />
                              دانلود بسته
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => handleVerify(signature)}
                            >
                              <ShieldCheckIcon />
                              تأیید امضا
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-muted-foreground"
                >
                  صورتحسابی با این فیلتر یافت نشد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {invoiceResponse
            ? `مجموع ${invoiceResponse.total.toLocaleString("fa-IR")} صورتحساب`
            : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isPending}
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
            disabled={page >= totalPages || isPending}
            onClick={() => setPage((prev) => prev + 1)}
          >
            بعدی
          </Button>
        </div>
      </div>
    </div>
  );
}
