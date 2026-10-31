"use client";

import { useEffect, useMemo, useState } from "react";
import { FileBarChart } from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { ExportButtons, FIELD_CLASS, PeriodControls } from "@/components/accounting/reports/report-controls";
import {
  BalanceSheetView,
  CashFlowView,
  EquityChangesView,
  IncomeStatementView,
  LedgerView,
  TrialBalanceView,
} from "@/components/accounting/reports/report-views";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getBalanceSheet,
  getCashFlow,
  getEquityChanges,
  getIncomeStatement,
  getLedgerReport,
  getSubsidiaryReport,
  getTrialBalanceReport,
  listFiscalYears,
} from "@/lib/api/accounting-reports-client";
import type {
  BalanceSheetReport,
  CashFlowReport,
  EquityChangesReport,
  FiscalYear,
  IncomeStatementReport,
  LedgerReport,
  ReportQuery,
  TrialBalanceColumns,
  TrialBalanceReport,
} from "@/types/accounting-reports";

const TABS = [
  { key: "trial-balance", label: "تراز آزمایشی" },
  { key: "subsidiary", label: "تراز تفصیلی" },
  { key: "ledger", label: "دفتر کل و معین" },
  { key: "balance-sheet", label: "ترازنامه" },
  { key: "income-statement", label: "سود و زیان" },
  { key: "cash-flow", label: "جریان نقد" },
  { key: "equity-changes", label: "تغییرات حقوق مالکانه" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

type Loaded =
  | { tab: "trial-balance" | "subsidiary"; data: TrialBalanceReport }
  | { tab: "ledger"; data: LedgerReport }
  | { tab: "balance-sheet"; data: BalanceSheetReport }
  | { tab: "income-statement"; data: IncomeStatementReport }
  | { tab: "cash-flow"; data: CashFlowReport }
  | { tab: "equity-changes"; data: EquityChangesReport };

export default function AccountingReportsPage() {
  const [tab, setTab] = useState<TabKey>("trial-balance");
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [query, setQuery] = useState<ReportQuery>({});
  const [columns, setColumns] = useState<TrialBalanceColumns>(6);
  const [level, setLevel] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [partyCode, setPartyCode] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listFiscalYears(controller.signal)
      .then((list) => {
        setYears(list);
        const open = list.find((year) => year.status === "OPEN") ?? list[list.length - 1];
        if (open) setQuery((current) => ({ ...current, fiscalYearId: current.fiscalYearId ?? open.id }));
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  const needsAccount = tab === "ledger" && !accountCode.trim();

  const exportQuery = useMemo(
    () => ({
      ...query,
      columns: tab === "trial-balance" || tab === "subsidiary" ? columns : undefined,
      level: tab === "trial-balance" ? level || undefined : undefined,
      accountCode: tab === "ledger" || tab === "subsidiary" ? accountCode.trim() || undefined : undefined,
      partyCode: tab === "ledger" ? partyCode.trim() || undefined : undefined,
    }),
    [query, tab, columns, level, accountCode, partyCode],
  );

  useEffect(() => {
    if (needsAccount) return;
    const controller = new AbortController();
    const { signal } = controller;
    const code = accountCode.trim();
    const load = async (): Promise<Loaded> => {
      switch (tab) {
        case "trial-balance":
          return { tab, data: await getTrialBalanceReport({ ...query, columns, level: level || undefined }, signal) };
        case "subsidiary":
          return { tab, data: await getSubsidiaryReport({ ...query, columns, accountCode: code || undefined }, signal) };
        case "ledger":
          return {
            tab,
            data: await getLedgerReport({ ...query, accountCode: code, partyCode: partyCode.trim() || undefined }, signal),
          };
        case "balance-sheet":
          return { tab, data: await getBalanceSheet(query, signal) };
        case "income-statement":
          return { tab, data: await getIncomeStatement(query, signal) };
        case "cash-flow":
          return { tab, data: await getCashFlow(query, signal) };
        case "equity-changes":
          return { tab, data: await getEquityChanges(query, signal) };
      }
    };
    const timer = setTimeout(() => {
      setLoading(true);
      load()
        .then((result) => {
          setLoaded(result);
          setError(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setLoaded(null);
          setError(loadErrorMessage(err));
        })
        .finally(() => {
          if (!signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tab, query, columns, level, accountCode, partyCode, needsAccount]);

  const showColumns = tab === "trial-balance" || tab === "subsidiary";

  return (
    <EnterpriseRouteGuard requireAdmin>
      <PageHeader
        title="گزارش‌های حسابداری"
        description="تراز، دفاتر و صورت‌های مالی از اسناد ثبت‌شده"
        icon={<FileBarChart className="size-6 text-indigo-500" />}
        actions={<ExportButtons report={tab} query={exportQuery} disabled={needsAccount} />}
      />

      <div role="tablist" aria-label="نوع گزارش" className="flex flex-wrap gap-1">
        {TABS.map((item) => (
          <Button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            variant={tab === item.key ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setLoaded(null);
              setTab(item.key);
            }}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <PeriodControls years={years} query={query} onChange={setQuery} />
        {showColumns && (
          <div className="grid gap-1">
            <Label htmlFor="report-columns">ستون‌ها</Label>
            <select
              id="report-columns"
              className={FIELD_CLASS}
              value={columns}
              onChange={(event) => setColumns(Number(event.target.value) as TrialBalanceColumns)}
            >
              {[2, 4, 6, 8, 10].map((count) => (
                <option key={count} value={count}>
                  {count} ستونی
                </option>
              ))}
            </select>
          </div>
        )}
        {tab === "trial-balance" && (
          <div className="grid gap-1">
            <Label htmlFor="report-level">سطح</Label>
            <select id="report-level" className={FIELD_CLASS} value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">حساب‌های ثبت‌شده</option>
              <option value="GROUP">گروه</option>
              <option value="KOL">کل</option>
              <option value="MOEIN">معین</option>
            </select>
          </div>
        )}
        {(tab === "ledger" || tab === "subsidiary") && (
          <div className="grid gap-1">
            <Label htmlFor="report-account">کد حساب</Label>
            <Input id="report-account" dir="ltr" className="w-32" value={accountCode} onChange={(event) => setAccountCode(event.target.value)} />
          </div>
        )}
        {tab === "ledger" && (
          <div className="grid gap-1">
            <Label htmlFor="report-party">کد تفصیلی</Label>
            <Input id="report-party" dir="ltr" className="w-32" value={partyCode} onChange={(event) => setPartyCode(event.target.value)} />
          </div>
        )}
      </div>

      <ErrorNotice title="گزارش ساخته نشد" message={error} />
      <LoadingLine show={loading} />

      <Card className="overflow-x-auto">
        {needsAccount && <p className="px-4 py-6 text-sm text-muted-foreground">کد حساب را وارد کنید.</p>}
        {loaded?.tab === "trial-balance" || loaded?.tab === "subsidiary" ? <TrialBalanceView report={loaded.data} /> : null}
        {!needsAccount && loaded?.tab === "ledger" && <LedgerView report={loaded.data} />}
        {loaded?.tab === "balance-sheet" && <BalanceSheetView report={loaded.data} />}
        {loaded?.tab === "income-statement" && <IncomeStatementView report={loaded.data} />}
        {loaded?.tab === "cash-flow" && <CashFlowView report={loaded.data} />}
        {loaded?.tab === "equity-changes" && <EquityChangesView report={loaded.data} />}
      </Card>
    </EnterpriseRouteGuard>
  );
}
