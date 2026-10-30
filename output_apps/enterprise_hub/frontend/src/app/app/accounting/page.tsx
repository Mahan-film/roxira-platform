"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpenCheck, Landmark } from "lucide-react";

import {
  EmptyImportState,
  ErrorNotice,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { AccountLedgerPanel } from "@/components/accounting/account-ledger-panel";
import { AccountingStats } from "@/components/accounting/accounting-stats";
import { JournalEntriesTable } from "@/components/accounting/journal-entries-table";
import { TrialBalanceTable } from "@/components/accounting/trial-balance-table";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getTrialBalance, listAccounts } from "@/lib/api/accounting-client";
import { formatMoneyRial } from "@/lib/fa-format";
import {
  ACCOUNT_TYPE_LABELS,
  type ChartOfAccount,
  type TrialBalanceResponse,
} from "@/types/accounting";

export default function SuiteAccountingPage() {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceResponse | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([listAccounts(controller.signal), getTrialBalance(controller.signal)])
      .then(([accountsResult, trialResult]) => {
        setAccounts(accountsResult);
        setTrialBalance(trialResult);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(loadErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  return (
    <EnterpriseRouteGuard requireAdmin>
      <PageHeader
        title="حساب‌ها"
        description="سرفصل حساب‌ها، تراز آزمایشی و دفتر روزنامه"
        icon={<BookOpenCheck className="size-6 text-indigo-500" />}
        actions={
          <Link href="/app/accounting/bank" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Landmark aria-hidden="true" />
            بانک و مغایرت‌گیری
          </Link>
        }
      />

      <ErrorNotice title="خطا در دریافت اطلاعات دفتر کل" message={error} />

      <AccountingStats trialBalance={trialBalance} />

      {!loading && !error && accounts.length === 0 ? (
        <EmptyImportState
          title="سرفصل حساب‌ها یا تراز افتتاحیه قبلی‌تان را اینجا رها کنید"
          hint="فایل اکسل یا PDF حساب‌ها را در صفحه ورود داده بارگذاری کنید"
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>سرفصل حساب‌ها</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>کد</TableHead>
                  <TableHead>نام حساب</TableHead>
                  <TableHead>نوع</TableHead>
                  <TableHead>مانده</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && accounts.length === 0
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <TableRow key={`skeleton-${index}`}>
                        {Array.from({ length: 4 }).map((__, cellIndex) => (
                          <TableCell key={cellIndex}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : accounts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs">{a.code}</TableCell>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell>{ACCOUNT_TYPE_LABELS[a.accountType]}</TableCell>
                        <TableCell>{formatMoneyRial(a.balance)}</TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </Card>

          <TrialBalanceTable
            trialBalance={trialBalance}
            isLoading={loading}
            errorMessage={null}
            selectedCode={selectedCode}
            onSelectAccount={(code) => setSelectedCode((cur) => (cur === code ? null : code))}
            onRefresh={refresh}
          />

          {selectedCode && (
            <AccountLedgerPanel
              code={selectedCode}
              refreshKey={refreshKey}
              onClose={() => setSelectedCode(null)}
            />
          )}

          <JournalEntriesTable refreshKey={refreshKey} />
        </>
      )}
    </EnterpriseRouteGuard>
  );
}
