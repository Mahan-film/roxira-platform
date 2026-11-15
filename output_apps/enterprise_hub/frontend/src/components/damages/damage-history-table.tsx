"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableColumnDef,
} from "@/components/ui/data-table";

import { listDamageCalculations } from "@/lib/api/damages-client";
import { ApiClientError } from "@/lib/api/http-client";
import { formatPersianDate, formatRial } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DAMAGE_CALCULATION_METHOD_LABELS,
  type DamageCalculationResponseDto,
  type PaginatedDamageCalculationResponse,
} from "@/types/damages";

const PAGE_SIZE = 10;

/**
 * جدول تاریخچه محاسبات خسارت تاخیر تادیه، پیاده‌سازی شده با کامپوننت مشترک DataTable
 * همراه با مرتب‌سازی، فیلتر سراسری، انتخاب سطرها، مخفی‌سازی ستون‌ها و خروجی CSV.
 */
export function DamageHistoryTable() {
  const [page, setPage] = useState(1);
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
    [page],
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

  const columns = useMemo<DataTableColumnDef<DamageCalculationResponseDto>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="تاریخ ثبت" />
        ),
        cell: ({ row }) => formatPersianDate(row.original.createdAt),
        meta: { title: "تاریخ ثبت" },
      },
      {
        accessorKey: "principalAmount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="اصل مبلغ" />
        ),
        cell: ({ row }) => formatRial(row.original.principalAmount),
        meta: {
          title: "اصل مبلغ",
          isNumeric: true,
          isSummable: true,
          formatValue: (val) => formatRial(Number(val) || 0),
        },
      },
      {
        accessorKey: "delayedDays",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="روزهای تاخیر" />
        ),
        cell: ({ row }) => row.original.delayedDays.toLocaleString("fa-IR"),
        meta: { title: "روزهای تاخیر", isNumeric: true },
      },
      {
        accessorKey: "calculationMethod",
        header: "روش محاسبه",
        cell: ({ row }) => (
          <Badge variant="secondary">
            {DAMAGE_CALCULATION_METHOD_LABELS[row.original.calculationMethod]}
          </Badge>
        ),
        meta: { title: "روش محاسبه" },
      },
      {
        accessorKey: "damageAmount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="مبلغ خسارت" />
        ),
        cell: ({ row }) => (
          <span className="font-medium text-primary">
            {formatRial(row.original.damageAmount)}
          </span>
        ),
        meta: {
          title: "مبلغ خسارت",
          isNumeric: true,
          isSummable: true,
          formatValue: (val) => formatRial(Number(val) || 0),
        },
      },
      {
        accessorKey: "totalPayable",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="مبلغ کل قابل پرداخت" />
        ),
        cell: ({ row }) => (
          <span className="font-medium">{formatRial(row.original.totalPayable)}</span>
        ),
        meta: {
          title: "مبلغ کل قابل پرداخت",
          isNumeric: true,
          isSummable: true,
          formatValue: (val) => formatRial(Number(val) || 0),
        },
      },
      {
        accessorKey: "contractReferenceNumber",
        header: "شماره مرجع",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.contractReferenceNumber ?? "—"}
          </span>
        ),
        meta: { title: "شماره مرجع" },
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>خطا در دریافت اطلاعات</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={response?.data ?? []}
        isLoading={isLoading}
        enableRowSelection
        enableCsvExport
        exportFilename="damage-history"
        filterPlaceholder="جستجو در سوابق محاسبات..."
        toolbarActions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => refresh()}
            disabled={isLoading}
            className="gap-1.5 text-xs h-9"
          >
            <RefreshCwIcon className={cn("size-3.5", isLoading && "animate-spin")} />
            <span>بروزرسانی</span>
          </Button>
        }
      />

      <div className="flex items-center justify-between text-sm text-muted-foreground pt-1">
        <span>
          {response ? `مجموع ${response.total.toLocaleString("fa-IR")} رکورد در سرور` : ""}
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
