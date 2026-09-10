"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { RefreshCwIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { listDamageCalculations } from "@/lib/api/damages-client";
import { ApiClientError } from "@/lib/api/http-client";
import { formatPersianDate, formatRial } from "@/lib/format";
import {
  DAMAGE_CALCULATION_METHOD_LABELS,
  type PaginatedDamageCalculationResponse,
} from "@/types/damages";

const PAGE_SIZE = 10;

/**
 * جدول تاریخچه محاسبات، متصل به `GET /enterprise-hub/damages`
 * (DamagesController.findAll -> QueryDamageCalculationDto).
 */
export function DamageHistoryTable() {
  const [page, setPage] = useState(1);
  const [contractReferenceNumber, setContractReferenceNumber] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [response, setResponse] =
    useState<PaginatedDamageCalculationResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fetchRecords = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await listDamageCalculations(
          {
            page,
            limit: PAGE_SIZE,
            contractReferenceNumber: contractReferenceNumber || undefined,
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
    [page, contractReferenceNumber],
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
  }, [refresh]);

  const isLoading = isPending;

  const totalPages = response ? Math.max(1, Math.ceil(response.total / response.limit)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form
          className="flex w-full items-center gap-2 sm:max-w-sm"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setContractReferenceNumber(searchInput.trim());
          }}
        >
          <Input
            placeholder="فیلتر بر اساس شماره قرارداد/فاکتور"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <Button type="submit" variant="outline" size="icon">
            <SearchIcon />
          </Button>
        </form>

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
              <TableHead>تاریخ ثبت</TableHead>
              <TableHead>اصل مبلغ</TableHead>
              <TableHead>روزهای تاخیر</TableHead>
              <TableHead>روش محاسبه</TableHead>
              <TableHead>مبلغ خسارت</TableHead>
              <TableHead>مبلغ کل قابل پرداخت</TableHead>
              <TableHead>شماره مرجع</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {Array.from({ length: 7 }).map((__, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : response && response.data.length > 0 ? (
              response.data.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatPersianDate(record.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatRial(record.principalAmount)}
                  </TableCell>
                  <TableCell>{record.delayedDays.toLocaleString("fa-IR")}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {DAMAGE_CALCULATION_METHOD_LABELS[record.calculationMethod]}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium text-primary">
                    {formatRial(record.damageAmount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium">
                    {formatRial(record.totalPayable)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {record.contractReferenceNumber ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  هیچ رکوردی یافت نشد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {response ? `مجموع ${response.total.toLocaleString("fa-IR")} رکورد` : ""}
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
