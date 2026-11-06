"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark } from "lucide-react";

import { ErrorNotice, LoadingLine, loadErrorMessage } from "@/components/app/app-ui";
import { BankAccountForm } from "@/components/accounting/bank/bank-account-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { RowActionsMenu, type RowAction } from "@/components/ui/row-actions-menu";
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
  getReconciliationSummary,
  listBankAccounts,
  listStatementLines,
} from "@/lib/api/banking-client";
import { bankLabel, lastStatementDate, unreconciledCount } from "@/lib/bank-accounts-ui";
import { formatJalaliDate, formatNumber } from "@/lib/fa-format";
import type { ChartOfAccount } from "@/types/accounting";
import type { BankAccount, ReconciliationSummary, StatementLine } from "@/types/banking";

const LOAD_ERROR = "خطا در بارگذاری";
const NOT_RECORDED = "ثبت نشده";

interface RowData {
  summary: ReconciliationSummary | null;
  summaryFailed: boolean;
  lines: StatementLine[] | null;
  linesFailed: boolean;
}

function FailedCell() {
  return <span className="text-destructive">{LOAD_ERROR}</span>;
}

function moneyCell(row: RowData | undefined, pick: (summary: ReconciliationSummary) => number) {
  if (!row) return "—";
  if (row.summaryFailed) return <FailedCell />;
  if (!row.summary) return "—";
  return <Money value={pick(row.summary)} />;
}

function unreconciledCell(row: RowData | undefined) {
  if (!row) return "—";
  if (row.summaryFailed) return <FailedCell />;
  if (!row.summary) return "—";
  return formatNumber(unreconciledCount(row.summary));
}

function lastStatementCell(row: RowData | undefined) {
  if (!row) return "—";
  if (row.linesFailed) return <FailedCell />;
  if (!row.lines) return "—";
  const date = lastStatementDate(row.lines);
  return date ? formatJalaliDate(date) : NOT_RECORDED;
}

/** List of bank accounts with their ledger link, balances and last statement date. */
export function BankAccountsList({
  onAccountsLoaded,
  onOpenStatement,
}: {
  onAccountsLoaded?: (accounts: BankAccount[]) => void;
  onOpenStatement?: (accountId: number) => void;
} = {}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [rows, setRows] = useState<Record<number, RowData>>({});
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [showForm, setShowForm] = useState(false);
  const [ledgerAccounts, setLedgerAccounts] = useState<ChartOfAccount[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const onAccountsLoadedRef = useRef(onAccountsLoaded);
  useEffect(() => {
    onAccountsLoadedRef.current = onAccountsLoaded;
  }, [onAccountsLoaded]);

  useEffect(() => {
    const controller = new AbortController();
    listBankAccounts(controller.signal)
      .then(async (list) => {
        if (controller.signal.aborted) return;
        setAccounts(list);
        setListError(null);
        onAccountsLoadedRef.current?.(list);
        const results = await Promise.all(
          list.map(async (account) => {
            const [summary, lines] = await Promise.allSettled([
              getReconciliationSummary(account.id, undefined, controller.signal),
              listStatementLines(account.id, {}, controller.signal),
            ]);
            return { id: account.id, summary, lines };
          }),
        );
        if (controller.signal.aborted) return;
        const next: Record<number, RowData> = {};
        for (const { id, summary, lines } of results) {
          next[id] = {
            summary: summary.status === "fulfilled" ? summary.value : null,
            summaryFailed: summary.status === "rejected",
            lines: lines.status === "fulfilled" ? lines.value : null,
            linesFailed: lines.status === "rejected",
          };
        }
        setRows(next);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setListError(loadErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    if (!showForm || ledgerAccounts !== null) return;
    const controller = new AbortController();
    listAccounts(controller.signal)
      .then((list) => {
        setLedgerAccounts(list);
        setFormError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFormError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, [showForm, ledgerAccounts]);

  function actionsFor(account: BankAccount): RowAction[] {
    const actions: RowAction[] = [
      {
        label: "مغایرت‌گیری بانکی",
        onSelect: () => router.push("/app/accounting/bank/reconcile"),
      },
    ];
    if (onOpenStatement) {
      actions.push({ label: "ورود صورتحساب", onSelect: () => onOpenStatement(account.id) });
    }
    return actions;
  }

  const desktopTable = (
    <div className="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>حساب بانکی</TableHead>
            <TableHead>حساب دفتر کل</TableHead>
            <TableHead>موجودی دفتر</TableHead>
            <TableHead>موجودی بانک</TableHead>
            <TableHead>ردیف مغایرت‌نشده</TableHead>
            <TableHead>آخرین صورتحساب</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">عملیات</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => {
            const row = rows[account.id];
            return (
              <TableRow key={account.id}>
                <TableCell className="font-medium">{account.name}</TableCell>
                <TableCell>
                  <span className="text-muted-foreground">{bankLabel(account.bankCode)}</span>{" "}
                  <bdi dir="ltr" className="tabular-nums">
                    {account.accountNumber}
                  </bdi>
                </TableCell>
                <TableCell>
                  <span dir="ltr" className="tabular-nums">
                    {account.ledgerAccountCode}
                  </span>{" "}
                  <span className="text-muted-foreground">{account.ledgerAccountName}</span>
                </TableCell>
                <TableCell>{moneyCell(row, (summary) => summary.bookBalance)}</TableCell>
                <TableCell>{moneyCell(row, (summary) => summary.bankBalance)}</TableCell>
                <TableCell>{unreconciledCell(row)}</TableCell>
                <TableCell>{lastStatementCell(row)}</TableCell>
                <TableCell className="text-end">
                  <RowActionsMenu label="عملیات" actions={actionsFor(account)} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  const mobileCards = (
    <div className="flex flex-col gap-3 md:hidden">
      {accounts.map((account) => {
        const row = rows[account.id];
        return (
          <Card key={account.id}>
            <CardContent className="flex flex-col gap-3 py-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold">{account.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {bankLabel(account.bankCode)}{" "}
                    <bdi dir="ltr" className="tabular-nums">
                      {account.accountNumber}
                    </bdi>
                  </p>
                </div>
                <RowActionsMenu label="عملیات" actions={actionsFor(account)} />
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">حساب دفتر کل</dt>
                  <dd className="truncate">
                    <span dir="ltr" className="tabular-nums">
                      {account.ledgerAccountCode}
                    </span>{" "}
                    {account.ledgerAccountName}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">ردیف مغایرت‌نشده</dt>
                  <dd>{unreconciledCell(row)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">موجودی دفتر</dt>
                  <dd>{moneyCell(row, (summary) => summary.bookBalance)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">موجودی بانک</dt>
                  <dd>{moneyCell(row, (summary) => summary.bankBalance)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">آخرین صورتحساب</dt>
                  <dd>{lastStatementCell(row)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );

  const emptyState = (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Landmark className="size-8 text-indigo-400" aria-hidden="true" />
        <p className="text-sm font-bold">هنوز حساب بانکی ثبت نشده است</p>
        <p className="max-w-md text-xs text-muted-foreground">
          برای شروع، حساب بانکی را با حساب دفتر کل آن وصل کنید.
        </p>
        <Button size="sm" onClick={() => setShowForm(true)}>
          + حساب بانکی
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      <LoadingLine show={loading} />
      <ErrorNotice title="خطا در بارگذاری حساب‌های بانکی" message={listError} />

      {showForm &&
        (ledgerAccounts ? (
          <BankAccountForm
            ledgerAccounts={ledgerAccounts}
            onCreated={() => {
              setShowForm(false);
              setRefreshKey((key) => key + 1);
            }}
            onCancel={() => setShowForm(false)}
          />
        ) : formError ? (
          <ErrorNotice title="خطا در بارگذاری حساب‌های دفتر کل" message={formError} />
        ) : (
          <LoadingLine show />
        ))}

      {!loading && !listError && accounts.length === 0
        ? emptyState
        : accounts.length > 0 && (
            <>
              {desktopTable}
              {mobileCards}
            </>
          )}
    </div>
  );
}
