"use client";

import { Fragment, useCallback, useEffect, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon, Undo2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import { RowActionsMenu, type RowAction } from "@/components/ui/row-actions-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  changeJournalEntryStatus,
  copyJournalEntry,
  listJournalEntries,
  reverseJournalEntry,
} from "@/lib/api/accounting-client";
import { ApiClientError } from "@/lib/api/http-client";
import { formatPersianDate } from "@/lib/format";
import { formatMoneyRial } from "@/lib/fa-format";
import { printVoucher } from "@/lib/print/open-print-window";
import { getVoucherAvailableActions } from "@/lib/voucher-actions";
import {
  JOURNAL_ENTRY_STATUS_LABELS,
  JournalEntryStatus,
  type JournalEntryResponse,
  type PaginatedJournalEntryResponse,
} from "@/types/accounting";

const PAGE_SIZE = 10;

interface JournalEntriesTableProps {
  refreshKey?: number;
  /** Opens the edit form for a non-final voucher chosen from the row menu. */
  onEdit?: (entry: JournalEntryResponse) => void;
}

const statusBadgeVariant = (status: JournalEntryStatus) => {
  switch (status) {
    case JournalEntryStatus.POSTED:
      return "default";
    case JournalEntryStatus.TEMPORARY:
      return "outline";
    case JournalEntryStatus.DRAFT:
      return "secondary";
    case JournalEntryStatus.VOID:
      return "destructive";
    default:
      return "secondary";
  }
};

/**
 * جدول دفتر روزنامه (General Journal) با صفحه‌بندی، نمایش بازشوی سطرهای
 * بدهکار/بستانکار و عملیات کامل چرخه عمر سند: پیش‌نویس، موقت، قطعی‌سازی و برگشت سند.
 */
export function JournalEntriesTable({ refreshKey = 0, onEdit }: JournalEntriesTableProps) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [entryNumber, setEntryNumber] = useState("");
  const [response, setResponse] = useState<PaginatedJournalEntryResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<number | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Modals for post and reverse actions
  const [postingEntry, setPostingEntry] = useState<JournalEntryResponse | null>(null);
  const [reversingEntry, setReversingEntry] = useState<JournalEntryResponse | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseDate, setReverseDate] = useState("");
  const [submittingModal, setSubmittingModal] = useState(false);

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

  const handleCopy = useCallback(
    async (entry: JournalEntryResponse) => {
      setSuccessMessage(null);
      setErrorMessage(null);
      setCopyingId(entry.id);
      try {
        const copy = await copyJournalEntry(entry.id);
        setSuccessMessage(`سند «${copy.entryNumber}» به‌صورت پیش‌نویس کپی شد.`);
        refresh();
      } catch (error) {
        if (error instanceof ApiClientError) {
          setErrorMessage(error.details.join(" | "));
        } else {
          setErrorMessage("کپی سند انجام نشد؛ ارتباط با سرور برقرار نشد.");
        }
      } finally {
        setCopyingId(null);
      }
    },
    [refresh],
  );

  const handleChangeStatus = useCallback(
    async (entry: JournalEntryResponse, targetStatus: JournalEntryStatus) => {
      setSuccessMessage(null);
      setErrorMessage(null);
      setActionLoadingId(entry.id);
      try {
        const updated = await changeJournalEntryStatus(entry.id, targetStatus, entry.version);
        const statusLabel = JOURNAL_ENTRY_STATUS_LABELS[targetStatus] ?? targetStatus;
        setSuccessMessage(`وضعیت سند «${updated.entryNumber}» به «${statusLabel}» تغییر یافت.`);
        refresh();
      } catch (error) {
        if (error instanceof ApiClientError) {
          setErrorMessage(error.details.join(" | "));
        } else {
          setErrorMessage("تغییر وضعیت سند انجام نشد؛ ارتباط با سرور برقرار نشد.");
        }
      } finally {
        setActionLoadingId(null);
      }
    },
    [refresh],
  );

  const handlePostConfirm = useCallback(async () => {
    if (!postingEntry) return;
    setSubmittingModal(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      const updated = await changeJournalEntryStatus(
        postingEntry.id,
        JournalEntryStatus.POSTED,
        postingEntry.version,
      );
      setSuccessMessage(
        `سند «${updated.entryNumber}» با موفقیت قطعی شد.${updated.permanentNumber ? ` (شماره قطعی: ${updated.permanentNumber})` : ""}`,
      );
      setPostingEntry(null);
      refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorMessage(error.details.join(" | "));
      } else {
        setErrorMessage("قطعی‌سازی سند انجام نشد؛ ارتباط با سرور برقرار نشد.");
      }
    } finally {
      setSubmittingModal(false);
    }
  }, [postingEntry, refresh]);

  const handleReverseSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!reversingEntry) return;
      setSubmittingModal(true);
      setSuccessMessage(null);
      setErrorMessage(null);
      try {
        const reversed = await reverseJournalEntry(reversingEntry.id, {
          date: reverseDate || undefined,
          reason: reverseReason.trim() || undefined,
        });
        setSuccessMessage(
          `سند معکوس «${reversed.entryNumber}» برای برگشت سند «${reversingEntry.entryNumber}» با موفقیت ثبت شد.`,
        );
        setReversingEntry(null);
        refresh();
      } catch (error) {
        if (error instanceof ApiClientError) {
          setErrorMessage(error.details.join(" | "));
        } else {
          setErrorMessage("برگشت سند انجام نشد؛ ارتباط با سرور برقرار نشد.");
        }
      } finally {
        setSubmittingModal(false);
      }
    },
    [reversingEntry, reverseDate, reverseReason, refresh],
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
              className="w-48 text-xs font-mono"
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
          <AlertCircle className="size-4" />
          <AlertTitle>خطا در عملیات</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {successMessage && (
        <Alert className="border-emerald-500/50 text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-4" />
          <AlertTitle>عملیات موفق</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead className="w-36">شماره سند</TableHead>
              <TableHead className="w-28">شمارهٔ قطعی</TableHead>
              <TableHead className="w-28">تاریخ</TableHead>
              <TableHead className="min-w-56">شرح</TableHead>
              <TableHead className="w-36">جمع بدهکار</TableHead>
              <TableHead className="w-36">جمع بستانکار</TableHead>
              <TableHead className="w-28">وضعیت</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
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
              response.data.map((entry) => {
                const isExpanded = expandedId === entry.id;
                const isBusy = actionLoadingId === entry.id || copyingId === entry.id;
                const caps = getVoucherAvailableActions(entry.status);

                const actions: RowAction[] = [
                  {
                    label: "چاپ سند",
                    onSelect: () =>
                      printVoucher(
                        entry,
                        JOURNAL_ENTRY_STATUS_LABELS[entry.status] ?? entry.status,
                      ),
                  },
                  {
                    label: "کپی سند",
                    disabled: isBusy || !caps.canCopy,
                    onSelect: () => void handleCopy(entry),
                  },
                  {
                    label: "ویرایش",
                    disabled: !onEdit || !caps.canEdit,
                    onSelect: () => onEdit?.(entry),
                  },
                ];

                if (caps.canTemporary) {
                  actions.push({
                    label: "تبدیل به موقت",
                    disabled: isBusy,
                    onSelect: () => void handleChangeStatus(entry, JournalEntryStatus.TEMPORARY),
                  });
                }

                if (caps.canDraft) {
                  actions.push({
                    label: "تبدیل به پیش‌نویس",
                    disabled: isBusy,
                    onSelect: () => void handleChangeStatus(entry, JournalEntryStatus.DRAFT),
                  });
                }

                if (caps.canPost) {
                  actions.push({
                    label: "ثبت قطعی (قطعی‌سازی)",
                    disabled: isBusy,
                    onSelect: () => setPostingEntry(entry),
                  });
                }

                if (caps.canReverse) {
                  actions.push({
                    label: "برگشت سند",
                    disabled: isBusy,
                    onSelect: () => {
                      setReversingEntry(entry);
                      setReverseReason("");
                      setReverseDate("");
                    },
                  });
                }

                return (
                  <Fragment key={entry.id}>
                    <TableRow>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setExpandedId(isExpanded ? null : entry.id)}
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
                      <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">
                        {entry.entryNumber}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {entry.permanentNumber ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatPersianDate(entry.date)}
                      </TableCell>
                      <TableCell className="text-xs">{entry.description}</TableCell>
                      <TableCell className="whitespace-nowrap text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {formatMoneyRial(entry.totalDebit)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-amber-600 dark:text-amber-400 tabular-nums">
                        {formatMoneyRial(entry.totalCredit)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(entry.status)}>
                          {JOURNAL_ENTRY_STATUS_LABELS[entry.status] ?? entry.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <RowActionsMenu label="عملیات سند" actions={actions} />
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${entry.id}-lines`} className="bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={8}>
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
                                  <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">
                                    بدهکار {formatMoneyRial(line.debit)}
                                  </span>
                                  <span className="text-amber-600 dark:text-amber-400 tabular-nums">
                                    بستانکار {formatMoneyRial(line.credit)}
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
                  colSpan={9}
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

      {/* Post Confirmation Drawer */}
      <Drawer
        open={Boolean(postingEntry)}
        onClose={() => setPostingEntry(null)}
        title={`قطعی‌سازی سند شماره ${postingEntry?.entryNumber ?? ""}`}
        size="md"
      >
        <div className="space-y-4 p-4 text-sm">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">
            <p className="font-semibold text-xs">هشدار قطعی‌سازی سند</p>
            <p className="mt-1 text-xs">
              قطعی‌سازی سند حسابداری برگشت‌ناپذیر است. با قطعی‌سازی، سند در دفاتر قانونی ثبت شده،
              شماره قطعی دائم به آن اختصاص می‌یابد و پس از آن ویرایش یا حذف سند غیرممکن خواهد بود
              (هرگونه اصلاح صرفاً از طریق صدور سند معکوس انجام می‌شود).
            </p>
          </div>

          <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">شماره سند:</span>
              <span className="font-mono font-semibold">{postingEntry?.entryNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">تاریخ:</span>
              <span>{postingEntry ? formatPersianDate(postingEntry.date) : ""}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">جمع کل سند:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {postingEntry ? formatMoneyRial(postingEntry.totalDebit) : ""}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">شرح:</span>
              <span>{postingEntry?.description}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submittingModal}
              onClick={() => setPostingEntry(null)}
            >
              انصراف
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={submittingModal}
              onClick={handlePostConfirm}
            >
              {submittingModal ? "در حال ثبت قطعی..." : "تأیید و ثبت قطعی سند"}
            </Button>
          </div>
        </div>
      </Drawer>

      {/* Reverse Voucher Drawer */}
      <Drawer
        open={Boolean(reversingEntry)}
        onClose={() => setReversingEntry(null)}
        title={`برگشت سند شماره ${reversingEntry?.entryNumber ?? ""}`}
        size="md"
      >
        <form onSubmit={handleReverseSubmit} className="space-y-4 p-4 text-sm">
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
            <p className="font-semibold flex items-center gap-1.5">
              <Undo2 className="size-3.5" />
              صدور سند معکوس (برگشت از ثبت)
            </p>
            <p className="mt-1 text-muted-foreground">
              اسناد قطعی هرگز دستکاری یا حذف نمی‌شوند. سیستم برای برگشت سند، یک سند معکوس خودکار با
              جابجایی ستون‌های بدهکار و بستانکار صادر می‌کند تا دفاتر همواره دقیق و منطبق بر قانون بمانند.
            </p>
          </div>

          <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">سند مبدأ:</span>
              <span className="font-mono font-semibold">{reversingEntry?.entryNumber}</span>
            </div>
            {reversingEntry?.permanentNumber && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">شماره دفتر قانونی:</span>
                <span className="font-mono">{reversingEntry.permanentNumber}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">مبلغ کل:</span>
              <span className="font-semibold">{reversingEntry ? formatMoneyRial(reversingEntry.totalDebit) : ""}</span>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div className="grid gap-1">
              <Label htmlFor="reverse-date">تاریخ سند برگشتی (اختیاری)</Label>
              <JalaliDateInput
                id="reverse-date"
                value={reverseDate}
                onChange={setReverseDate}
              />
              <span className="text-[11px] text-muted-foreground">
                در صورت خالی بودن، تاریخ جاری روز اعمال می‌شود.
              </span>
            </div>

            <div className="grid gap-1">
              <Label htmlFor="reverse-reason">دلیل برگشت سند (اختیاری)</Label>
              <Input
                id="reverse-reason"
                placeholder="مثلاً اشتباه در سرفصل، انصراف خریدار، اصلاح دوره"
                value={reverseReason}
                maxLength={200}
                onChange={(e) => setReverseReason(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submittingModal}
              onClick={() => setReversingEntry(null)}
            >
              انصراف
            </Button>
            <Button type="submit" size="sm" disabled={submittingModal}>
              {submittingModal ? "در حال صدور..." : "صدور سند معکوس"}
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
