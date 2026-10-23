"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Link2, Link2Off, Loader2, Plus, Sparkles } from "lucide-react";

import { ErrorNotice, StatCard, loadErrorMessage } from "@/components/app/app-ui";
import { BankAccountForm } from "@/components/accounting/bank/bank-account-form";
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
import { listAccounts } from "@/lib/api/accounting-client";
import {
  autoMatch,
  createEntryFromStatementLine,
  getReconciliationSummary,
  listBankAccounts,
  listBookLines,
  listStatementLines,
  matchStatementLine,
  unmatchStatementLine,
} from "@/lib/api/banking-client";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { isoToJalaliInput, jalaliToIso } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import type { ChartOfAccount } from "@/types/accounting";
import {
  BANK_LABELS,
  MATCH_METHOD_LABELS,
  type BankAccount,
  type BookLine,
  type ReconciliationSummary,
  type StatementLine,
} from "@/types/banking";

type LineFilter = "all" | "unmatched" | "matched";

const FILTER_LABELS: Array<[LineFilter, string]> = [
  ["unmatched", "تطبیق‌نخورده"],
  ["matched", "تطبیق‌خورده"],
  ["all", "همه"],
];

/** Same rule as the backend matcher: deposit = book debit, withdrawal = book credit (±1 rial). */
function amountsAgree(line: StatementLine, book: BookLine): boolean {
  if (line.deposit > 0) return book.credit === 0 && Math.abs(book.debit - line.deposit) <= 1;
  if (line.withdrawal > 0) return book.debit === 0 && Math.abs(book.credit - line.withdrawal) <= 1;
  return false;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function BankReconciliation() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<ChartOfAccount[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  const [lines, setLines] = useState<StatementLine[]>([]);
  const [bookLines, setBookLines] = useState<BookLine[]>([]);
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);
  const [filter, setFilter] = useState<LineFilter>("unmatched");
  const [asOfInput, setAsOfInput] = useState(() => isoToJalaliInput(todayIso()));
  const [windowDays, setWindowDays] = useState(3);

  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [entryLineId, setEntryLineId] = useState<number | null>(null);
  const [counterCode, setCounterCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  const asOfIso = jalaliToIso(asOfInput);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([listBankAccounts(controller.signal), listAccounts(controller.signal)])
      .then(([bank, ledger]) => {
        setAccounts(bank);
        setLedgerAccounts(ledger);
        setAccountId((current) => current ?? bank[0]?.id ?? null);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(loadErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingAccounts(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (accountId === null) return;
    const controller = new AbortController();
    Promise.all([
      listStatementLines(
        accountId,
        filter === "all" ? {} : { status: filter },
        controller.signal,
      ),
      listBookLines(accountId, { unmatchedOnly: true }, controller.signal),
      getReconciliationSummary(accountId, asOfIso ?? undefined, controller.signal),
    ])
      .then(([statement, book, totals]) => {
        setLines(statement);
        setBookLines(book);
        setSummary(totals);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, [accountId, filter, asOfIso, refreshKey]);

  const selectedLine = useMemo(
    () => lines.find((line) => line.id === selectedLineId) ?? null,
    [lines, selectedLineId],
  );
  const account = accounts.find((item) => item.id === accountId) ?? null;
  const counterAccounts = ledgerAccounts.filter(
    (ledger) => ledger.id !== account?.ledgerAccountId,
  );

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      refresh();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const runAutoMatch = () =>
    run(async () => {
      if (accountId === null) return null;
      const result = await autoMatch(accountId, { windowDays });
      return `${formatNumber(result.matched)} سطر تطبیق خورد؛ ${formatNumber(
        result.ambiguous,
      )} سطر چند نامزد هم‌ارز دارد و ${formatNumber(result.stillUnmatched)} سطر باز مانده است.`;
    });

  const match = (book: BookLine) =>
    run(async () => {
      if (!selectedLine) return null;
      await matchStatementLine(selectedLine.id, book.id);
      setSelectedLineId(null);
      return `سطر بانک با سند ${book.entryNumber} تطبیق خورد.`;
    });

  const unmatch = (line: StatementLine) =>
    run(async () => {
      await unmatchStatementLine(line.id);
      return "تطبیق لغو شد.";
    });

  const createEntry = (line: StatementLine) =>
    run(async () => {
      await createEntryFromStatementLine(line.id, { counterAccountCode: counterCode });
      setEntryLineId(null);
      setCounterCode("");
      return "سند ثبت و با سطر بانک تطبیق داده شد.";
    });

  function onAccountCreated(created: BankAccount) {
    setAccounts((current) => [...current, created]);
    setAccountId(created.id);
    setShowForm(false);
  }

  if (loadingAccounts) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        در حال بارگذاری...
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ErrorNotice title="خطا در مغایرت‌گیری بانکی" message={error} />
      {notice && (
        <p role="status" className="flex items-center gap-2 text-sm text-emerald-600">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          {notice}
        </p>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
          {accounts.length > 0 ? (
            <label className="flex items-center gap-2">
              <span>حساب بانکی:</span>
              <select
                value={accountId ?? ""}
                onChange={(event) => {
                  setAccountId(Number(event.target.value));
                  setSelectedLineId(null);
                }}
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              >
                {accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {BANK_LABELS[item.bankCode]} — {item.accountNumber}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-muted-foreground">
              هنوز حساب بانکی تعریف نشده است. ابتدا حساب را تعریف و به یک حساب دفتر کل وصل کنید.
            </span>
          )}
          {account && (
            <span className="text-xs text-muted-foreground">
              حساب دفتر کل: {account.ledgerAccountCode} {account.ledgerAccountName}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="ms-auto"
            onClick={() => setShowForm((value) => !value)}
          >
            <Plus aria-hidden="true" />
            حساب بانکی جدید
          </Button>
        </CardContent>
      </Card>

      {showForm && (
        <BankAccountForm
          ledgerAccounts={ledgerAccounts}
          onCreated={onAccountCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {account && summary && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-3">
                خلاصه مغایرت
                <label className="flex items-center gap-2 text-sm font-normal">
                  <span>تا تاریخ</span>
                  <Input
                    dir="ltr"
                    value={asOfInput}
                    onChange={(event) => setAsOfInput(event.target.value)}
                    aria-invalid={asOfIso === null}
                    aria-label="تاریخ مغایرت‌گیری (شمسی)"
                    placeholder="1403/07/30"
                    className="w-32 text-center"
                  />
                </label>
                <Badge variant={summary.difference === 0 ? "secondary" : "destructive"}>
                  {summary.difference === 0 ? "تراز است" : "اختلاف دارد"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatCard label="مانده طبق بانک" value={formatMoneyRial(summary.bankBalance)} />
                <StatCard label="مانده طبق دفاتر" value={formatMoneyRial(summary.bookBalance)} />
                <StatCard
                  label="اختلاف پس از تعدیل"
                  value={formatMoneyRial(summary.difference)}
                  hint={`${formatNumber(summary.matchedCount)} تطبیق، ${formatNumber(
                    summary.unmatchedStatementCount,
                  )} سطر بانک و ${formatNumber(summary.unmatchedBookCount)} سطر دفتر باز`}
                />
              </div>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                <SummaryRow label="مانده بانک" value={summary.bankBalance} />
                <SummaryRow label="مانده دفاتر" value={summary.bookBalance} />
                <SummaryRow label="+ واریز در راه (در دفاتر، نه در بانک)" value={summary.unmatchedBookDebits} />
                <SummaryRow label="+ واریزهای بانک که ثبت نشده" value={summary.unmatchedBankDeposits} />
                <SummaryRow label="− چک‌های وصول‌نشده (در دفاتر، نه در بانک)" value={summary.unmatchedBookCredits} />
                <SummaryRow label="− برداشت‌های بانک که ثبت نشده" value={summary.unmatchedBankWithdrawals} />
                <SummaryRow label="= مانده تعدیل‌شده بانک" value={summary.adjustedBankBalance} strong />
                <SummaryRow label="= مانده تعدیل‌شده دفاتر" value={summary.adjustedBookBalance} strong />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-3">
                سطرهای صورتحساب بانک
                <div className="flex gap-1 text-xs font-normal" role="group" aria-label="فیلتر وضعیت">
                  {FILTER_LABELS.map(([key, label]) => (
                    <Button
                      key={key}
                      size="xs"
                      variant={filter === key ? "default" : "outline"}
                      onClick={() => setFilter(key)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <div className="ms-auto flex items-center gap-2 text-sm font-normal">
                  <label className="flex items-center gap-1">
                    <span>پنجره</span>
                    <Input
                      type="number"
                      min={0}
                      max={31}
                      value={windowDays}
                      onChange={(event) => setWindowDays(Number(event.target.value) || 0)}
                      className="w-16 text-center"
                      aria-label="پنجره تاریخ (روز)"
                    />
                    <span>روز</span>
                  </label>
                  <Button size="sm" disabled={busy} onClick={runAutoMatch}>
                    {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                    تطبیق خودکار
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            {lines.length === 0 ? (
              <CardContent className="text-sm text-muted-foreground">
                سطری نیست. صورتحساب اکسل/CSV بانک را در صفحه ورود داده بارگذاری کنید.
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>تاریخ</TableHead>
                    <TableHead>شرح</TableHead>
                    <TableHead>پیگیری</TableHead>
                    <TableHead>برداشت</TableHead>
                    <TableHead>واریز</TableHead>
                    <TableHead>مانده</TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead>اقدام</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow
                      key={line.id}
                      className={cn(selectedLineId === line.id && "bg-indigo-500/10")}
                    >
                      <TableCell className="whitespace-nowrap">{formatJalaliDate(line.txnDate)}</TableCell>
                      <TableCell className="max-w-64 truncate" title={line.description ?? ""}>
                        {line.description ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{line.reference ?? "—"}</TableCell>
                      <TableCell>{line.withdrawal ? formatNumber(line.withdrawal) : "—"}</TableCell>
                      <TableCell>{line.deposit ? formatNumber(line.deposit) : "—"}</TableCell>
                      <TableCell>{line.balance === null ? "—" : formatNumber(line.balance)}</TableCell>
                      <TableCell>
                        {line.matchedJournalLineId !== null ? (
                          <Badge variant="secondary">
                            {line.matchMethod ? MATCH_METHOD_LABELS[line.matchMethod] : "تطبیق‌خورده"}
                          </Badge>
                        ) : (
                          <Badge variant="outline">باز</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {line.matchedJournalLineId !== null ? (
                          <Button size="xs" variant="ghost" disabled={busy} onClick={() => unmatch(line)}>
                            <Link2Off aria-hidden="true" />
                            لغو تطبیق
                          </Button>
                        ) : entryLineId === line.id ? (
                          <div className="flex items-center gap-1">
                            <select
                              value={counterCode}
                              onChange={(event) => setCounterCode(event.target.value)}
                              aria-label="حساب مقابل"
                              className="h-6 max-w-40 rounded-md border border-input bg-background px-1 text-xs"
                            >
                              <option value="">حساب مقابل…</option>
                              {counterAccounts.map((ledger) => (
                                <option key={ledger.id} value={ledger.code}>
                                  {ledger.code} {ledger.name}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="xs"
                              disabled={busy || !counterCode}
                              onClick={() => createEntry(line)}
                            >
                              ثبت
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => setEntryLineId(null)}>
                              انصراف
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <Button
                              size="xs"
                              variant={selectedLineId === line.id ? "default" : "outline"}
                              onClick={() =>
                                setSelectedLineId((current) => (current === line.id ? null : line.id))
                              }
                            >
                              <Link2 aria-hidden="true" />
                              تطبیق دستی
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => {
                                setEntryLineId(line.id);
                                setCounterCode("");
                              }}
                            >
                              ثبت سند
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                سطرهای باز دفتر حساب {account.ledgerAccountCode}
                {selectedLine && (
                  <span className="ms-2 text-sm font-normal text-muted-foreground">
                    — یک سطر هم‌مبلغ را برای تطبیق با سطر بانک {formatJalaliDate(selectedLine.txnDate)} انتخاب کنید
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            {bookLines.length === 0 ? (
              <CardContent className="text-sm text-muted-foreground">
                همه سطرهای دفتر این حساب تطبیق خورده‌اند.
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>تاریخ</TableHead>
                    <TableHead>شماره سند</TableHead>
                    <TableHead>شرح</TableHead>
                    <TableHead>بدهکار</TableHead>
                    <TableHead>بستانکار</TableHead>
                    <TableHead>اقدام</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookLines.map((book) => {
                    const candidate = selectedLine ? amountsAgree(selectedLine, book) : false;
                    return (
                      <TableRow
                        key={book.id}
                        className={cn(selectedLine && !candidate && "opacity-50")}
                      >
                        <TableCell className="whitespace-nowrap">{formatJalaliDate(book.date)}</TableCell>
                        <TableCell className="font-mono text-xs">{book.entryNumber}</TableCell>
                        <TableCell className="max-w-64 truncate" title={book.description ?? ""}>
                          {book.description ?? "—"}
                        </TableCell>
                        <TableCell>{book.debit ? formatNumber(book.debit) : "—"}</TableCell>
                        <TableCell>{book.credit ? formatNumber(book.credit) : "—"}</TableCell>
                        <TableCell>
                          {candidate && (
                            <Button size="xs" disabled={busy} onClick={() => match(book)}>
                              <Link2 aria-hidden="true" />
                              تطبیق
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4 border-b border-border/50 py-1", strong && "font-bold")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{formatMoneyRial(value)}</dd>
    </div>
  );
}
