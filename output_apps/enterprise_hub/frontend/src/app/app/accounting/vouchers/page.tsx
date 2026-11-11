"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpenCheck,
  CalendarRange,
  FileBarChart,
  FilePlus2,
  Gauge,
  Landmark,
  ListTree,
  Network,
  ReceiptText,
  Wallet,
} from "lucide-react";

import {
  ErrorNotice,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { EmptyState } from "@/components/app/empty-state";
import { JournalEntryForm } from "@/components/accounting/journal-entry-form";
import { AccountReview } from "@/components/accounting/account-review";
import { AccountingStats } from "@/components/accounting/accounting-stats";
import { JournalEntriesTable } from "@/components/accounting/journal-entries-table";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Button, buttonVariants } from "@/components/ui/button";
import { getTrialBalance, listAccounts } from "@/lib/api/accounting-client";
import {
  type ChartOfAccount,
  type JournalEntryResponse,
  type TrialBalanceResponse,
} from "@/types/accounting";

export default function VouchersPage() {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceResponse | null>(null);
  const [showVoucher, setShowVoucher] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntryResponse | null>(null);
  const [viewMode, setViewMode] = useState<"vouchers" | "review">("vouchers");
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
    <EnterpriseRouteGuard>
      <PageHeader
        title="اسناد حسابداری"
        description="دفتر روزنامه، ثبت، ویرایش و تأیید اسناد حسابداری"
        icon={<ReceiptText className="size-6 text-indigo-500" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                setEditingEntry(null);
                setShowVoucher((v) => !v);
              }}
              aria-expanded={showVoucher}
            >
              <FilePlus2 aria-hidden="true" />
              سند جدید
            </Button>
            <Button
              variant={viewMode === "review" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode((m) => (m === "review" ? "vouchers" : "review"))}
              className="gap-1.5"
            >
              <ListTree aria-hidden="true" className="size-4" />
              {viewMode === "review" ? "مشاهده اسناد" : "مرور حساب‌ها"}
            </Button>
            <Link
              href="/app/accounting/chart"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Network aria-hidden="true" />
              درخت حساب‌ها
            </Link>
            <Link
              href="/app/accounting/dashboard"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Gauge aria-hidden="true" />
              داشبورد
            </Link>
            <Link
              href="/app/reports"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <FileBarChart aria-hidden="true" />
              گزارش‌ها
            </Link>
            <Link
              href="/app/accounting/fiscal-years"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <CalendarRange aria-hidden="true" />
              سال مالی
            </Link>
            <Link
              href="/app/accounting/petty-cash"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Wallet aria-hidden="true" />
              صندوق و تنخواه
            </Link>
            <Link
              href="/app/accounting/bank"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Landmark aria-hidden="true" />
              حساب‌های بانکی
            </Link>
          </div>
        }
      />

      <ErrorNotice title="خطا در دریافت اطلاعات حسابداری" message={error} />

      {viewMode === "review" ? (
        <AccountReview />
      ) : (
        <>
          <AccountingStats trialBalance={trialBalance} />

          {(showVoucher || editingEntry) && (
            <JournalEntryForm
              accounts={accounts}
              entry={editingEntry}
              onCancel={() => {
                setShowVoucher(false);
                setEditingEntry(null);
              }}
              onCreated={() => {
                setShowVoucher(false);
                setEditingEntry(null);
                refresh();
              }}
              onUpdated={() => {
                setShowVoucher(false);
                setEditingEntry(null);
                refresh();
              }}
            />
          )}

          {!loading && !error && accounts.length === 0 ? (
            <EmptyState
              icon={<BookOpenCheck className="size-6 text-indigo-500" aria-hidden="true" />}
              description="هنوز حسابی تعریف نشده یا سندی ثبت نگردیده است. ابتدا سرفصل حساب‌ها را بررسی و اولین سند را ثبت کنید."
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingEntry(null);
                    setShowVoucher((v) => !v);
                  }}
                  aria-expanded={showVoucher}
                >
                  <FilePlus2 aria-hidden="true" />
                  سند جدید
                </Button>
              }
            />
          ) : (
            <JournalEntriesTable
              refreshKey={refreshKey}
              onEdit={(entry) => {
                setShowVoucher(false);
                setEditingEntry(entry);
              }}
            />
          )}
        </>
      )}
    </EnterpriseRouteGuard>
  );
}
