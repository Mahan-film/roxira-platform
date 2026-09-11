"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { BookOpenCheck, Layers, ShieldCheck, Sparkles } from "lucide-react";

import { AccountingStats } from "@/components/accounting/accounting-stats";
import { AccountLedgerPanel } from "@/components/accounting/account-ledger-panel";
import { JournalEntriesTable } from "@/components/accounting/journal-entries-table";
import { JournalEntryForm } from "@/components/accounting/journal-entry-form";
import { TrialBalanceTable } from "@/components/accounting/trial-balance-table";
import { SiteHeader } from "@/components/layout/site-header";
import { RoxiraFooter } from "@/components/layout/roxira-footer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getTrialBalance, listAccounts } from "@/lib/api/accounting-client";
import { ApiClientError } from "@/lib/api/http-client";
import type { ChartOfAccount, TrialBalanceResponse } from "@/types/accounting";

/**
 * صفحه جامع حسابداری دوبل و دفتر روزنامه سازمانی.
 *
 * شامل کارت‌های بنتو خلاصه وضعیت، فرم ثبت آرتیکل‌های دوطرفه، جدول تراز
 * آزمایشی/گردش حساب‌ها، دفتر معین و دفتر روزنامه — همه متصل به ماژول
 * `enterprise-hub/accounting` در لایه NestJS.
 */
export default function AccountingPage() {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceResponse | null>(
    null,
  );
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPending, startTransition] = useTransition();

  const loadOverview = useCallback((signal?: AbortSignal) => {
    startTransition(async () => {
      try {
        const [accountsResult, trialBalanceResult] = await Promise.all([
          listAccounts(signal),
          getTrialBalance(signal),
        ]);
        setAccounts(accountsResult);
        setTrialBalance(trialBalanceResult);
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
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview, refreshKey]);

  function handleRefresh() {
    setRefreshKey((key) => key + 1);
  }

  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BookOpenCheck className="size-6 text-indigo-500" />
            حسابداری دوبل و دفتر روزنامه سازمانی
          </h1>
          <p className="text-sm text-muted-foreground">
            ثبت اسناد تراز، تراز آزمایشی و گردش حساب‌ها — متصل به{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              /enterprise-hub/accounting
            </code>
          </p>
        </div>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>خطا در دریافت اطلاعات دفتر کل</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <AccountingStats trialBalance={trialBalance} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <JournalEntryForm accounts={accounts} onCreated={handleRefresh} />
          </div>

          <Card className="h-full border-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent ring-1 ring-indigo-500/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="size-4 text-indigo-500" />
                راهنمای دفتر دوطرفه
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
              <p>
                در هر آرتیکل، جمع مبالغ بدهکار باید دقیقاً با جمع مبالغ بستانکار
                برابر باشد؛ در غیر این‌صورت ثبت سند توسط سرور رد می‌شود.
              </p>
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 size-4 text-indigo-500" />
                <span>شماره سند باید یکتا باشد و می‌توانید آن را خودکار تولید کنید.</span>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 text-emerald-500" />
                <span>
                  تمام مبالغ به ریال ثبت و مانده هر حساب به‌صورت اتمیک به‌روزرسانی
                  می‌شود.
                </span>
              </div>
              {accounts.length === 0 && (
                <Skeleton className="h-4 w-3/4" />
              )}
            </CardContent>
          </Card>
        </div>

        {isPending && !trialBalance ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <TrialBalanceTable
            trialBalance={trialBalance}
            isLoading={isPending}
            errorMessage={null}
            selectedCode={selectedCode}
            onSelectAccount={(code) =>
              setSelectedCode((current) => (current === code ? null : code))
            }
            onRefresh={handleRefresh}
          />
        )}

        {selectedCode && (
          <AccountLedgerPanel
            code={selectedCode}
            refreshKey={refreshKey}
            onClose={() => setSelectedCode(null)}
          />
        )}

        <JournalEntriesTable refreshKey={refreshKey} />
      </main>
      <RoxiraFooter />
    </div>
  );
}