"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpenCheck, CalendarRange, FileBarChart, FilePlus2, Gauge, Landmark, Wallet } from "lucide-react";

import {
  ErrorNotice,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { EmptyState } from "@/components/app/empty-state";
import { AccountTreeCard } from "@/components/accounting/account-tree-card";
import { JournalEntryForm } from "@/components/accounting/journal-entry-form";
import { AccountLedgerPanel } from "@/components/accounting/account-ledger-panel";
import { AccountingStats } from "@/components/accounting/accounting-stats";
import { JournalEntriesTable } from "@/components/accounting/journal-entries-table";
import { TrialBalanceTable } from "@/components/accounting/trial-balance-table";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Button, buttonVariants } from "@/components/ui/button";
import { getTrialBalance, listAccounts } from "@/lib/api/accounting-client";
import {
  type ChartOfAccount,
  type TrialBalanceResponse,
} from "@/types/accounting";

export default function SuiteAccountingPage() {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceResponse | null>(null);
  const [showVoucher, setShowVoucher] = useState(false);
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setShowVoucher((v) => !v)} aria-expanded={showVoucher}>
              <FilePlus2 aria-hidden="true" />
              سند جدید
            </Button>
            <Link href="/app/accounting/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Gauge aria-hidden="true" />
              داشبورد
            </Link>
            <Link href="/app/accounting/reports" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <FileBarChart aria-hidden="true" />
              گزارش‌ها
            </Link>
            <Link href="/app/accounting/fiscal-years" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <CalendarRange aria-hidden="true" />
              سال مالی
            </Link>
            <Link href="/app/accounting/petty-cash" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Wallet aria-hidden="true" />
              تنخواه
            </Link>
            <Link href="/app/accounting/bank" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Landmark aria-hidden="true" />
              حساب‌های بانکی
            </Link>
          </div>
        }
      />

      <ErrorNotice title="خطا در دریافت اطلاعات دفتر کل" message={error} />

      <AccountingStats trialBalance={trialBalance} />

      {showVoucher && (
        <JournalEntryForm
          accounts={accounts}
          onCreated={() => {
            setShowVoucher(false);
            refresh();
          }}
        />
      )}

      {!loading && !error && accounts.length === 0 ? (
        <EmptyState
          icon={<BookOpenCheck className="size-6 text-indigo-500" aria-hidden="true" />}
          description="مدیریت سرفصل حساب‌ها، تراز آزمایشی و ثبت اسناد دوبل حسابداری در این بخش انجام می‌شود."
          action={
            <Button size="sm" onClick={() => setShowVoucher((v) => !v)} aria-expanded={showVoucher}>
              <FilePlus2 aria-hidden="true" />
              سند جدید
            </Button>
          }
        />
      ) : (
        <>
          <AccountTreeCard accounts={accounts} onCreated={refresh} />

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
