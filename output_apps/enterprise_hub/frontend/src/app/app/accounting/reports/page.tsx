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
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import { MoneyUnitSwitch } from "@/components/ui/money-unit-switch";
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
  { key: "ageing", label: "گزارش سنی" },
  { key: "chart-of-accounts", label: "سرفصل حساب‌ها" },
  { key: "journal-book", label: "دفتر روزنامه" },
  { key: "general-ledger-book", label: "دفتر کل (چاپی)" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Reports with an Excel/PDF export but no on-screen view yet (their JSON endpoints come later). */
type ExportOnlyTab = "ageing" | "chart-of-accounts" | "journal-book" | "general-ledger-book";
const isExportOnly = (tab: TabKey): tab is ExportOnlyTab =>
  tab === "ageing" || tab === "chart-of-accounts" || isBook(tab);
/** Legal books (#249): page-numbered PDF with totals carried page to page. */
const isBook = (tab: TabKey) => tab === "journal-book" || tab === "general-ledger-book";

const EDGES_PATTERN = /^\s*\d+(\s*[,،]\s*\d+)*\s*$/;

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
  const [ageingSide, setAgeingSide] = useState<"receivable" | "payable">("receivable");
  const [ageingTo, setAgeingTo] = useState("");
  const [ageingEdges, setAgeingEdges] = useState("30,60,90");
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
  const badEdges = tab === "ageing" && !EDGES_PATTERN.test(ageingEdges);

  const exportQuery = useMemo(() => {
    if (tab === "ageing") {
      return {
        side: ageingSide,
        to: ageingTo || undefined,
        edges: ageingEdges.replace(/[\s]/g, "").replace(/،/g, ","),
        accountCode: accountCode.trim() || undefined,
        partyCode: partyCode.trim() || undefined,
      };
    }
    if (tab === "chart-of-accounts") return {};
    return {
      ...query,
      columns: tab === "trial-balance" || tab === "subsidiary" ? columns : undefined,
      level: tab === "trial-balance" || tab === "general-ledger-book" ? level || undefined : undefined,
      accountCode: tab === "ledger" || tab === "subsidiary" ? accountCode.trim() || undefined : undefined,
      partyCode: tab === "ledger" ? partyCode.trim() || undefined : undefined,
    };
  }, [query, tab, columns, level, accountCode, partyCode, ageingSide, ageingTo, ageingEdges]);

  useEffect(() => {
    if (needsAccount || isExportOnly(tab)) return;
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
        default:
          throw new Error(`report ${tab} has no on-screen view`);
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
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MoneyUnitSwitch />
            <ExportButtons report={tab} query={exportQuery} disabled={needsAccount || badEdges} />
          </div>
        }
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
        {(!isExportOnly(tab) || isBook(tab)) && <PeriodControls years={years} query={query} onChange={setQuery} />}
        {tab === "ageing" && (
          <>
            <div className="grid gap-1">
              <Label htmlFor="ageing-side">نوع</Label>
              <select
                id="ageing-side"
                className={FIELD_CLASS}
                value={ageingSide}
                onChange={(event) => setAgeingSide(event.target.value as "receivable" | "payable")}
              >
                <option value="receivable">دریافتنی‌ها</option>
                <option value="payable">پرداختنی‌ها</option>
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ageing-to">در تاریخ</Label>
              <JalaliDateInput id="ageing-to" value={ageingTo} onChange={(to) => setAgeingTo(to)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ageing-edges">بازه‌ها (روز)</Label>
              <Input
                id="ageing-edges"
                dir="ltr"
                className="w-32"
                aria-invalid={badEdges}
                value={ageingEdges}
                onChange={(event) => setAgeingEdges(event.target.value)}
              />
            </div>
          </>
        )}
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
        {(tab === "trial-balance" || tab === "general-ledger-book") && (
          <div className="grid gap-1">
            <Label htmlFor="report-level">سطح</Label>
            <select id="report-level" className={FIELD_CLASS} value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">{tab === "general-ledger-book" ? "کل" : "حساب‌های ثبت‌شده"}</option>
              <option value="GROUP">گروه</option>
              {tab !== "general-ledger-book" && <option value="KOL">کل</option>}
              <option value="MOEIN">معین</option>
            </select>
          </div>
        )}
        {(tab === "ledger" || tab === "subsidiary" || tab === "ageing") && (
          <div className="grid gap-1">
            <Label htmlFor="report-account">کد حساب</Label>
            <Input id="report-account" dir="ltr" className="w-32" value={accountCode} onChange={(event) => setAccountCode(event.target.value)} />
          </div>
        )}
        {(tab === "ledger" || tab === "ageing") && (
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
        {tab === "ageing" && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {badEdges
              ? "بازه‌ها را به صورت عددهای صعودی با کاما وارد کنید، مثلاً 30,60,90."
              : "مانده هر طرف حساب به تفکیک سن اقلام باز (از تاریخ سند). بدون تاریخ، امروز در نظر گرفته می‌شود. خروجی را با دکمه‌های Excel یا PDF بگیرید."}
          </p>
        )}
        {isBook(tab) && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {tab === "journal-book"
              ? "همه ردیف‌های اسناد قطعی دوره به ترتیب تاریخ و سند، با شماره ردیف پیوسته."
              : "گردش هر حساب کل (یا سطح انتخابی) به تفکیک سند، با مانده ابتدا، مانده جاری و مانده پایان؛ هر حساب از صفحه تازه."}{" "}
            هر صفحه شماره «صفحه n از N» و جمع نقل از صفحه قبل و نقل به صفحه بعد دارد. فایل PDF را چاپ کنید.
          </p>
        )}
        {tab === "chart-of-accounts" && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            فهرست کامل حساب‌ها با ماهیت، سطح و حساب بالاتر. فایل Excel آن را می‌توانید در بخش ورود داده دوباره وارد کنید.
          </p>
        )}
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
