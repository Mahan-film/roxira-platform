"use client";

import { Fragment, useCallback, useEffect, useState, useTransition } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { listJournalEntries } from "@/lib/api/accounting-client";
import { ApiClientError } from "@/lib/api/http-client";
import { formatPersianDate, formatRial } from "@/lib/format";
import {
  JOURNAL_ENTRY_STATUS_LABELS,
  type PaginatedJournalEntryResponse,
} from "@/types/accounting";

const PAGE_SIZE = 10;

interface JournalEntriesTableProps {
  refreshKey?: number;
}

/**
 * جدول دفتر روزنامه (General Journal) با صفحه‌بندی و نمایش بازشوی سطرهای
 * بدهکار/بستانکار هر سند. متصل به `GET /enterprise-hub/accounting/journal-entries`.
 */
export function JournalEntriesTable({ refreshKey = 0 }: JournalEntriesTableProps) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [entryNumber, setEntryNumber] = useState("");
  const [response, setResponse] = useState<PaginatedJournalEntryResponse | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const fetchRecords = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await listJournalEntries(
          { page, limit: PAGE_SIZE, entryNumber: entryNumber || undefined },
          signal,
        );
        setResponse(result);
        setErrorMessage(null);
      } catch (error) {
        if (error instanceof ApiClientError) {
          setErrorMessage(error.details.join(" | "));
        } else if (!(error instanceof DOMException)) {
          setErrorMessage("ارتباط با سرور برقرار نشد.");
        }
      }
    },
    [page, entryNumber],
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

  const totalPages = response
    ? Math.max(1, Math.ceil(response.total / response.limit))
    : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">دفتر روزنامه (اسناد حسابداری)</h2>
        <div className="flex items-center gap-2">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setEntryNumber(searchInput.trim());
            }}
          >
            <Input
              placeholder="جست‌وجوی شماره سند"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="w-48"
            />
            <Button type="submit" variant="outline" size="sm">
              جست‌وجو
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => refresh()}
            disabled={isPending}
            title="بروزرسانی"
          >
            <RefreshCwIcon className={isPending ? "animate-spin" : undefined} />
          </Button>
        </div>
      </div>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>خطا در دریافت اسناد</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead className="w-36">شماره سند</TableHead>
              <TableHead className="w-28">تاریخ</TableHead>
              <TableHead className="min-w-56">شرح</TableHead>
              <TableHead className="w-36">جمع بدهکار</TableHead>
              <TableHead className="w-36">جمع بستانکار</TableHead>
              <TableHead className="w-28">وضعیت</TableHead>
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
            ) : response && response.data.length > 0 ? (
              response.data.map((entry) => {
                const isExpanded = expandedId === entry.id;
                return (
                  <Fragment key={entry.id}>
                    <TableRow>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() =>
                            setExpandedId(isExpanded ? null : entry.id)
                          }
                          title="نمایش سطرها"
                        >
                          <ChevronDownIcon
                            className={
                              isExpanded
                                ? "rotate-180 transition-transform"
                                : "transition-transform"
                            }
                          />
                        </Button>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {entry.entryNumber}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatPersianDate(entry.date)}
                      </TableCell>
                      <TableCell>{entry.description}</TableCell>
                      <TableCell className="whitespace-nowrap text-emerald-600 dark:text-emerald-400">
                        {formatRial(entry.totalDebit)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-amber-600 dark:text-amber-400">
                        {formatRial(entry.totalCredit)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {JOURNAL_ENTRY_STATUS_LABELS[entry.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${entry.id}-lines`} className="bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={6}>
                          <div className="flex flex-col gap-2 py-1">
                            {entry.lines.map((line) => (
                              <div
                                key={line.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-xs"
                              >
                                <span className="flex items-center gap-2">
                                  <span className="font-mono text-muted-foreground">
                                    {line.accountCode}
                                  </span>
                                  <span>{line.accountName}</span>
                                  {line.description && (
                                    <span className="text-muted-foreground">
                                      — {line.description}
                                    </span>
                                  )}
                                </span>
                                <span className="flex items-center gap-3">
                                  <span className="text-emerald-600 dark:text-emerald-400">
                                    بدهکار {formatRial(line.debit)}
                                  </span>
                                  <span className="text-amber-600 dark:text-amber-400">
                                    بستانکار {formatRial(line.credit)}
                                  </span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-muted-foreground"
                >
                  هیچ سند حسابداری ثبت نشده است.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {response ? `مجموع ${response.total.toLocaleString("fa-IR")} سند` : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isPending}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            <ChevronRightIcon />
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
            <ChevronLeftIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}