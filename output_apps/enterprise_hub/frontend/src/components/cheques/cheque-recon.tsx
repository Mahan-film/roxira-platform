"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ErrorNotice, StatCard, loadErrorMessage } from "@/components/app/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { applyChequeRecon, getChequeRecon, matchChequeRecon } from "@/lib/api/cheques-client";
import { listBankAccounts } from "@/lib/api/banking-client";
import { RECON_STATE_LABELS } from "@/lib/cheques-ui";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import type { BankAccount } from "@/types/banking";
import { DIRECTION_LABELS, type ChequeRecon, type ReconItem, type ReconState } from "@/types/cheques";

const SELECT_CLASS = "h-8 rounded-lg border border-input bg-background px-2 text-sm";

/**
 * Matches cleared cheques to bank statement lines. The pairing and its checks live in the
 * backend (it only uses the banking module's public service); this page shows the proposals and
 * lets the user confirm them one by one or all unambiguous ones at once.
 */
export function ChequeRecon() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState<number | null>(null);
  const [result, setResult] = useState<{ key: string; recon: ChequeRecon } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    listBankAccounts(controller.signal)
      .then((rows) => {
        setAccounts(rows);
        if (rows.length === 1) setBankAccountId(rows[0].id);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  const reconKey = `${bankAccountId}:${refreshKey}`;
  useEffect(() => {
    if (bankAccountId === null) return;
    const controller = new AbortController();
    getChequeRecon({ bankAccountId }, controller.signal)
      .then((value) => {
        setResult({ key: reconKey, recon: value });
        setError(null);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, [bankAccountId, refreshKey, reconKey]);
  const recon = result?.key === reconKey ? result.recon : null;
  const loading = bankAccountId !== null && recon === null && error === null;

  async function confirm(item: ReconItem, statementLineId: number) {
    if (bankAccountId === null) return;
    setBusy(true);
    setError(null);
    try {
      await matchChequeRecon({ bankAccountId, eventId: item.eventId, statementLineId });
      setNotice(`چک ${item.chequeNumber} با سطر صورتحساب تطبیق خورد.`);
      refresh();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function applyAll() {
    if (bankAccountId === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await applyChequeRecon({ bankAccountId });
      setNotice(
        `${formatNumber(result.matched)} مورد تطبیق خورد؛ ${formatNumber(result.skippedAmbiguous)} مورد مبهم رد شد` +
          (result.failed ? `؛ ${formatNumber(result.failed)} مورد را ماژول بانک نپذیرفت.` : "."),
      );
      refresh();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const counts: Record<ReconState, number> = recon?.counts ?? { reconciled: 0, suggested: 0, unmatched: 0, no_bank_line: 0 };

  return (
    <div className="flex flex-col gap-4">
      <ErrorNotice title="خطا" message={error} />
      {notice && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          aria-label="حساب بانکی"
          value={bankAccountId ?? ""}
          onChange={(e) => setBankAccountId(e.target.value ? Number(e.target.value) : null)}
          className={SELECT_CLASS}
        >
          <option value="">حساب بانکی را انتخاب کنید</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.accountNumber})
            </option>
          ))}
        </select>
        <Button size="sm" disabled={busy || counts.suggested === 0} onClick={() => void applyAll()}>
          تطبیق همه موارد بی‌ابهام
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        سند وصول چک روی حساب «بانک» ثبت می‌شود؛ اگر حساب بانکی شما به حساب دفتر کل دیگری وصل است، وضعیت «سند وصول روی حساب این بانک نیست» نمایش داده می‌شود.
      </p>

      {bankAccountId !== null && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(Object.keys(RECON_STATE_LABELS) as ReconState[]).map((state) => (
            <StatCard key={state} label={RECON_STATE_LABELS[state]} value={formatNumber(counts[state])} />
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>وصول چک‌ها و صورتحساب بانک</CardTitle>
        </CardHeader>
        <CardContent>
          {bankAccountId === null ? (
            <p className="text-sm text-muted-foreground">برای شروع، یک حساب بانکی انتخاب کنید.</p>
          ) : loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              در حال بارگذاری...
            </p>
          ) : !recon || recon.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">هنوز چکی وصول نشده است.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>تاریخ وصول</TableHead>
                  <TableHead>نوع</TableHead>
                  <TableHead>چک</TableHead>
                  <TableHead>مبلغ</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead>سطر صورتحساب</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recon.items.map((item) => (
                  <TableRow key={item.eventId}>
                    <TableCell>{formatJalaliDate(item.eventDate)}</TableCell>
                    <TableCell>{DIRECTION_LABELS[item.direction]}</TableCell>
                    <TableCell>
                      <span dir="ltr">{item.chequeNumber}</span>
                      <span className="block text-xs text-muted-foreground">{item.partyName}</span>
                    </TableCell>
                    <TableCell>{formatMoneyRial(Number(item.amount))}</TableCell>
                    <TableCell>
                      <Badge variant={item.state === "reconciled" ? "secondary" : item.state === "suggested" ? "default" : "outline"}>
                        {RECON_STATE_LABELS[item.state]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.state === "suggested" ? (
                        <div className="flex flex-col gap-1">
                          {item.candidates.map((c) => (
                            <div key={c.statementLineId} className="flex items-center gap-2">
                              <span className="text-xs">
                                {formatJalaliDate(c.txnDate)} {c.description ?? ""} {c.reference ? `(${c.reference})` : ""}
                              </span>
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => void confirm(item, c.statementLineId)}>
                                تأیید تطبیق
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : item.state === "reconciled" ? (
                        <span className="text-xs text-muted-foreground">سطر {formatNumber(item.matchedStatementLineId)}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
