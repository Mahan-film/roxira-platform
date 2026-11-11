"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  Eye,
  FileSpreadsheet,
  Filter,
  Layers,
  ListTree,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  getLedgerReport,
  getSubsidiaryReport,
  getTrialBalanceReport,
  listFiscalYears,
} from "@/lib/api/accounting-reports-client";
import { formatMoneyRial } from "@/lib/fa-format";
import { formatPersianDate } from "@/lib/format";
import type {
  FiscalYear,
  LedgerReport,
  TrialBalanceColumns,
  TrialBalanceReport,
  TrialBalanceRow,
} from "@/types/accounting-reports";
import { VoucherDetailModal } from "./voucher-detail-modal";

type DrillLevel = "KOL" | "MOEIN" | "TAFSILI" | "LINES";

interface SelectedAccount {
  code: string;
  name: string;
}

export function AccountReview() {
  const [level, setLevel] = useState<DrillLevel>("KOL");
  const [selectedKol, setSelectedKol] = useState<SelectedAccount | null>(null);
  const [selectedMoein, setSelectedMoein] = useState<SelectedAccount | null>(null);
  const [selectedParty, setSelectedParty] = useState<SelectedAccount | null>(null);
  const [activeVoucherId, setActiveVoucherId] = useState<number | null>(null);

  // Filter states
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<number | undefined>(undefined);
  const [columns, setColumns] = useState<TrialBalanceColumns>(6);
  const [searchFilter, setSearchFilter] = useState("");

  // Report data states
  const [tbReport, setTbReport] = useState<TrialBalanceReport | null>(null);
  const [ledgerReport, setLedgerReport] = useState<LedgerReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refresh = useCallback(() => setRefreshTrigger((k) => k + 1), []);

  // Load fiscal years on mount
  useEffect(() => {
    const controller = new AbortController();
    listFiscalYears(controller.signal)
      .then((years) => {
        setFiscalYears(years);
        if (years.length > 0 && !selectedFiscalYearId) {
          setSelectedFiscalYearId(years[0].id);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [selectedFiscalYearId]);

  // Load data based on current level and selections
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const query = {
      fiscalYearId: selectedFiscalYearId,
      columns,
    };

    if (level === "KOL") {
      getTrialBalanceReport({ ...query, level: "KOL" }, controller.signal)
        .then((res) => {
          setTbReport(res);
          setLedgerReport(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError("خطا در دریافت تراز کل.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    } else if (level === "MOEIN" && selectedKol) {
      getTrialBalanceReport(
        { ...query, level: "MOEIN", accountCode: selectedKol.code },
        controller.signal,
      )
        .then((res) => {
          setTbReport(res);
          setLedgerReport(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(`خطا در دریافت تراز معین حساب کل ${selectedKol.code}.`);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    } else if (level === "TAFSILI" && selectedMoein) {
      getSubsidiaryReport(
        { ...query, accountCode: selectedMoein.code },
        controller.signal,
      )
        .then((res) => {
          setTbReport(res);
          setLedgerReport(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(`خطا در دریافت تراز تفصیلی حساب معین ${selectedMoein.code}.`);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    } else if (level === "LINES" && selectedMoein) {
      getLedgerReport(
        {
          fiscalYearId: selectedFiscalYearId,
          accountCode: selectedMoein.code,
          partyCode: selectedParty?.code,
        },
        controller.signal,
      )
        .then((res) => {
          setLedgerReport(res);
          setTbReport(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(`خطا در دریافت گردش اسناد حساب.`);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }

    return () => controller.abort();
  }, [level, selectedKol, selectedMoein, selectedParty, selectedFiscalYearId, columns, refreshTrigger]);

  function drillToKol() {
    setLevel("KOL");
    setSelectedKol(null);
    setSelectedMoein(null);
    setSelectedParty(null);
  }

  function drillToMoein(kol: SelectedAccount) {
    setSelectedKol(kol);
    setLevel("MOEIN");
    setSelectedMoein(null);
    setSelectedParty(null);
  }

  function drillToTafsili(moein: SelectedAccount) {
    setSelectedMoein(moein);
    setLevel("TAFSILI");
    setSelectedParty(null);
  }

  function drillToLines(moein: SelectedAccount, party?: SelectedAccount) {
    setSelectedMoein(moein);
    setSelectedParty(party ?? null);
    setLevel("LINES");
  }

  // Filter rows by search keyword
  const filteredTbRows = (tbReport?.rows ?? []).filter((r) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.trim().toLowerCase();
    return r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
  });

  const filteredLedgerLines = (ledgerReport?.lines ?? []).filter((l) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.trim().toLowerCase();
    return (
      l.entryNumber.toLowerCase().includes(q) ||
      (l.description || "").toLowerCase().includes(q) ||
      (l.partyCode || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Header & Controls */}
      <Card>
        <CardHeader className="pb-3 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ListTree className="size-5 text-indigo-500" />
              <CardTitle className="text-base font-bold">مرور حساب‌ها (Drill-Down)</CardTitle>
              <Badge variant="outline" className="font-mono text-xs">
                {level === "KOL"
                  ? "سطح ۱: حساب‌های کل"
                  : level === "MOEIN"
                    ? "سطح ۲: حساب‌های معین"
                    : level === "TAFSILI"
                      ? "سطح ۳: حساب‌های تفصیلی"
                      : "سطح ۴: گردش اسناد و مانده جاری"}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {fiscalYears.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">سال مالی:</span>
                  <select
                    className="h-8 rounded-md border bg-background px-2 text-xs font-medium"
                    value={selectedFiscalYearId ?? ""}
                    onChange={(e) =>
                      setSelectedFiscalYearId(e.target.value ? Number(e.target.value) : undefined)
                    }
                  >
                    {fiscalYears.map((fy) => (
                      <option key={fy.id} value={fy.id}>
                        {fy.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {level !== "LINES" && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">ستون‌ها:</span>
                  <div className="flex rounded-md border p-0.5">
                    {([2, 4, 6, 8] as TrialBalanceColumns[]).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColumns(c)}
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          columns === c
                            ? "bg-indigo-600 text-white"
                            : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Button variant="outline" size="sm" onClick={refresh} title="بروزرسانی">
                <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Breadcrumb Trail */}
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs">
            <button
              type="button"
              onClick={drillToKol}
              className={`flex items-center gap-1 rounded px-2 py-1 font-semibold transition-colors ${
                level === "KOL"
                  ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Layers className="size-3.5" />
              تراز کل
            </button>

            {selectedKol && (
              <>
                <ChevronLeft className="size-3.5 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => drillToMoein(selectedKol)}
                  className={`flex items-center gap-1 rounded px-2 py-1 font-semibold transition-colors ${
                    level === "MOEIN"
                      ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span className="font-mono text-[11px]">{selectedKol.code}</span> — {selectedKol.name}
                </button>
              </>
            )}

            {selectedMoein && (
              <>
                <ChevronLeft className="size-3.5 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => drillToTafsili(selectedMoein)}
                  className={`flex items-center gap-1 rounded px-2 py-1 font-semibold transition-colors ${
                    level === "TAFSILI"
                      ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span className="font-mono text-[11px]">{selectedMoein.code}</span> — {selectedMoein.name}
                </button>
              </>
            )}

            {selectedParty && (
              <>
                <ChevronLeft className="size-3.5 text-muted-foreground" />
                <span className="rounded bg-indigo-50 px-2 py-1 font-semibold text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">
                  تفصیلی: <span className="font-mono">{selectedParty.code}</span>
                </span>
              </>
            )}

            {level === "LINES" && !selectedParty && (
              <>
                <ChevronLeft className="size-3.5 text-muted-foreground" />
                <span className="rounded bg-indigo-50 px-2 py-1 font-semibold text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">
                  گردش اسناد (دفتر)
                </span>
              </>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <div className="flex items-center justify-between gap-3 pb-3">
            <div className="relative w-72">
              <Input
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="فیلتر در ردیف‌ها..."
                className="h-8 pr-8 text-xs font-medium"
              />
              <Search className="absolute right-2.5 top-2 size-3.5 text-muted-foreground" />
            </div>

            {level !== "KOL" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (level === "LINES") {
                    if (selectedParty) setLevel("TAFSILI");
                    else setLevel("MOEIN");
                  } else if (level === "TAFSILI") {
                    setLevel("MOEIN");
                  } else if (level === "MOEIN") {
                    setLevel("KOL");
                  }
                }}
                className="gap-1 text-xs"
              >
                <ArrowLeft className="size-3.5" />
                بازگشت به سطح قبل
              </Button>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-center text-xs text-destructive">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : level === "LINES" && ledgerReport ? (
            /* Level 4: Voucher Lines with Running Balance */
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between rounded-lg bg-muted/40 p-3 text-xs">
                <div>
                  <span className="text-muted-foreground">حساب: </span>
                  <span className="font-mono font-bold">{ledgerReport.accountCode}</span> —{" "}
                  <span className="font-semibold">{ledgerReport.accountName}</span>
                  {ledgerReport.partyCode && (
                    <span className="mr-3 text-muted-foreground">
                      تفصیلی: <span className="font-mono font-bold text-foreground">{ledgerReport.partyCode}</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-muted-foreground">مانده ابتدای دوره: </span>
                    <span className="font-mono font-bold text-foreground">
                      {formatMoneyRial(ledgerReport.opening)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">مانده پایان دوره: </span>
                    <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {formatMoneyRial(ledgerReport.closing)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center">#</TableHead>
                      <TableHead className="w-24">تاریخ</TableHead>
                      <TableHead className="w-32">شماره سند</TableHead>
                      <TableHead className="w-24">شماره دائم</TableHead>
                      <TableHead className="min-w-56">شرح آرتیکل</TableHead>
                      <TableHead className="w-32 text-left">بدهکار</TableHead>
                      <TableHead className="w-32 text-left">بستانکار</TableHead>
                      <TableHead className="w-16 text-center">تشخیص</TableHead>
                      <TableHead className="w-36 text-left font-bold text-indigo-600 dark:text-indigo-400">
                        مانده جاری
                      </TableHead>
                      <TableHead className="w-20 text-center">سند</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLedgerLines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                          هیچ گردش سندی در این بازه یافت نشد.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredLedgerLines.map((line, idx) => {
                        const debitBig = BigInt(line.debit || 0);
                        const creditBig = BigInt(line.credit || 0);
                        const runningBig = BigInt(line.running || 0);
                        const zeroBig = BigInt(0);
                        const diag = runningBig > zeroBig ? "بد" : runningBig < zeroBig ? "بس" : "—";
                        const runningDisplay = runningBig < zeroBig ? -runningBig : runningBig;
                        return (
                          <TableRow key={`${line.journalEntryId}-${idx}`} className="hover:bg-muted/50">
                            <TableCell className="text-center font-mono text-xs text-muted-foreground">
                              {idx + 1}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {formatPersianDate(line.date)}
                            </TableCell>
                            <TableCell className="font-mono text-xs font-semibold">
                              {line.entryNumber}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {line.permanentNumber ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs">{line.description}</TableCell>
                            <TableCell className="text-left font-mono text-xs">
                              {debitBig > zeroBig ? formatMoneyRial(String(debitBig)) : "—"}
                            </TableCell>
                            <TableCell className="text-left font-mono text-xs">
                              {creditBig > zeroBig ? formatMoneyRial(String(creditBig)) : "—"}
                            </TableCell>
                            <TableCell className="text-center font-semibold text-xs text-muted-foreground">
                              {diag}
                            </TableCell>
                            <TableCell className="text-left font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                              {formatMoneyRial(String(runningDisplay))}
                            </TableCell>
                            <TableCell className="text-center">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => setActiveVoucherId(line.journalEntryId)}
                                title="مشاهده سند حسابداری"
                              >
                                <Eye className="size-4 text-indigo-500" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-2 text-xs">
                <span>تعداد آرتیکل‌ها: {ledgerReport.lines.length}</span>
                <div className="flex items-center gap-6">
                  <div>
                    <span className="text-muted-foreground">جمع گردش بدهکار: </span>
                    <span className="font-mono font-bold text-foreground">
                      {formatMoneyRial(ledgerReport.totalDebit)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">جمع گردش بستانکار: </span>
                    <span className="font-mono font-bold text-foreground">
                      {formatMoneyRial(ledgerReport.totalCredit)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Levels 1, 2, 3: Trial Balance Grids (Kol, Moein, Tafsili) */
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">کد حساب</TableHead>
                    <TableHead className="min-w-48">عنوان حساب</TableHead>
                    {(columns === 6 || columns === 8) && (
                      <>
                        <TableHead className="w-28 text-left">افتتاحیه بد</TableHead>
                        <TableHead className="w-28 text-left">افتتاحیه بس</TableHead>
                      </>
                    )}
                    <TableHead className="w-32 text-left">گردش بدهکار</TableHead>
                    <TableHead className="w-32 text-left">گردش بستانکار</TableHead>
                    <TableHead className="w-32 text-left font-bold text-indigo-600 dark:text-indigo-400">
                      مانده بدهکار
                    </TableHead>
                    <TableHead className="w-32 text-left font-bold text-indigo-600 dark:text-indigo-400">
                      مانده بستانکار
                    </TableHead>
                    <TableHead className="w-36 text-center">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTbRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={columns === 6 || columns === 8 ? 8 : 6}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        هیچ حسابی در این سطح یافت نشد.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTbRows.map((row) => (
                      <TableRow key={row.code} className="hover:bg-muted/50">
                        <TableCell className="font-mono text-xs font-bold text-muted-foreground">
                          {row.code}
                        </TableCell>
                        <TableCell className="text-sm font-medium text-foreground">
                          {row.name}
                        </TableCell>
                        {(columns === 6 || columns === 8) && (
                          <>
                            <TableCell className="text-left font-mono text-xs">
                              {BigInt(row.openingDebit || 0) > BigInt(0)
                                ? formatMoneyRial(String(row.openingDebit))
                                : "—"}
                            </TableCell>
                            <TableCell className="text-left font-mono text-xs">
                              {BigInt(row.openingCredit || 0) > BigInt(0)
                                ? formatMoneyRial(String(row.openingCredit))
                                : "—"}
                            </TableCell>
                          </>
                        )}
                        <TableCell className="text-left font-mono text-xs">
                          {BigInt(row.periodDebit || 0) > BigInt(0)
                            ? formatMoneyRial(String(row.periodDebit))
                            : "—"}
                        </TableCell>
                        <TableCell className="text-left font-mono text-xs">
                          {BigInt(row.periodCredit || 0) > BigInt(0)
                            ? formatMoneyRial(String(row.periodCredit))
                            : "—"}
                        </TableCell>
                        <TableCell className="text-left font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          {BigInt(row.endingDebit || 0) > BigInt(0)
                            ? formatMoneyRial(String(row.endingDebit))
                            : "—"}
                        </TableCell>
                        <TableCell className="text-left font-mono text-xs font-semibold text-rose-600 dark:text-rose-400">
                          {BigInt(row.endingCredit || 0) > BigInt(0)
                            ? formatMoneyRial(String(row.endingCredit))
                            : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {level === "KOL" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs font-medium"
                              onClick={() => drillToMoein({ code: row.code, name: row.name })}
                            >
                              مرور معین
                              <ChevronLeft className="size-3.5" />
                            </Button>
                          ) : level === "MOEIN" ? (
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs font-medium"
                                onClick={() => drillToTafsili({ code: row.code, name: row.name })}
                                title="مرور تفصیلی‌های این معین"
                              >
                                تفصیلی
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs font-medium"
                                onClick={() => drillToLines({ code: row.code, name: row.name })}
                                title="گردش اسناد این حساب"
                              >
                                اسناد
                              </Button>
                            </div>
                          ) : (
                            /* TAFSILI level */
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs font-medium"
                              onClick={() => {
                                const partyCode = row.code.includes("/")
                                  ? row.code.split("/")[1]
                                  : row.code;
                                drillToLines(selectedMoein!, {
                                  code: partyCode,
                                  name: row.name,
                                });
                              }}
                            >
                              گردش اسناد
                              <ChevronLeft className="size-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Voucher Detail Modal */}
      <VoucherDetailModal
        journalEntryId={activeVoucherId}
        onClose={() => setActiveVoucherId(null)}
      />
    </div>
  );
}
