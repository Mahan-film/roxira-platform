"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Filter,
  Layers,
  Search,
} from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import { MoneyUnitSwitch } from "@/components/ui/money-unit-switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UNIT_SUFFIX, formatReportMoney } from "@/lib/fa-format";
import { useMoneyUnit } from "@/lib/money-unit";
import { getTrialBalanceByCostCentre, listFiscalYears } from "@/lib/api/accounting-reports-client";
import {
  TRIAL_BALANCE_GROUP_LABELS,
  type CostCentreSection,
  type CostCentreTrialBalanceQuery,
  type CostCentreTrialBalanceReport,
  type FiscalYear,
  type TrialBalanceAmounts,
  type TrialBalanceColumns,
  type TrialBalanceGroup,
} from "@/types/accounting-reports";
import {
  calculateReportSummary,
  costCentreTrialBalanceToCsv,
  filterSections,
  formatCentreTitle,
  getCentreDepthLabel,
} from "@/lib/cost-centre-report";

const FIELD_CLASS =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const AMOUNT_CELL = "text-left tabular-nums whitespace-nowrap text-xs";

function CostCentreTrialBalanceView() {
  const [unit] = useMoneyUnit();
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [query, setQuery] = useState<CostCentreTrialBalanceQuery>({
    columns: 6,
    level: "",
    includeClosing: false,
    costCenterCode: "",
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [report, setReport] = useState<CostCentreTrialBalanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCentres, setExpandedCentres] = useState<Record<string, boolean>>({});

  // Load fiscal years once
  useEffect(() => {
    const controller = new AbortController();
    listFiscalYears(controller.signal)
      .then((list) => {
        setYears(list);
        const open = list.find((y) => y.status === "OPEN") ?? list[list.length - 1];
        if (open) {
          setQuery((curr) => ({ ...curr, fiscalYearId: curr.fiscalYearId ?? open.id }));
        }
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(loadErrorMessage(err));
        }
      });
    return () => controller.abort();
  }, []);

  // Fetch report data
  const fetchReport = () => {
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    getTrialBalanceByCostCentre(
      {
        fiscalYearId: query.fiscalYearId,
        from: query.from || undefined,
        to: query.to || undefined,
        columns: query.columns ?? 6,
        level: query.level || undefined,
        includeClosing: query.includeClosing ? true : undefined,
        costCenterCode: query.costCenterCode?.trim() || undefined,
      },
      controller.signal,
    )
      .then((data) => {
        setReport(data);
        // By default expand all sections
        const initialExpanded: Record<string, boolean> = {};
        for (const centre of data.centres) {
          initialExpanded[centre.code ?? "unassigned"] = true;
        }
        setExpandedCentres(initialExpanded);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(loadErrorMessage(err));
        }
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.fiscalYearId, query.columns, query.level, query.includeClosing]);

  const summary = useMemo(() => {
    if (!report) return null;
    return calculateReportSummary(report);
  }, [report]);

  const filteredCentres = useMemo(() => {
    if (!report) return [];
    return filterSections(report.centres, searchTerm);
  }, [report, searchTerm]);

  const toggleExpand = (key: string) => {
    setExpandedCentres((curr) => ({ ...curr, [key]: !curr[key] }));
  };

  const toggleAll = (expand: boolean) => {
    if (!report) return;
    const next: Record<string, boolean> = {};
    for (const centre of report.centres) {
      next[centre.code ?? "unassigned"] = expand;
    }
    setExpandedCentres(next);
  };

  const handleExportCsv = () => {
    if (!report) return;
    const csvContent = costCentreTrialBalanceToCsv(report);
    const blob = new Blob(["\ufeff", csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trial-balance-cost-centres-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderGroupAmounts = (amounts: TrialBalanceAmounts, groups: TrialBalanceGroup[]) => {
    return groups.flatMap((group) => {
      const debit = amounts[`${group}Debit`];
      const credit = amounts[`${group}Credit`];
      return [
        <TableCell key={`${group}-debit`} className={AMOUNT_CELL}>
          {formatReportMoney(debit, unit)}
        </TableCell>,
        <TableCell key={`${group}-credit`} className={AMOUNT_CELL}>
          {formatReportMoney(credit, unit)}
        </TableCell>,
      ];
    });
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        icon={<Layers className="size-6 text-primary" />}
        title="تراز آزمایشی به تفکیک مرکز هزینه"
        description="گردش و مانده حساب‌های دفتر کل به تفکیک ساختار درختی مراکز هزینه و سطوح حسابداری"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MoneyUnitSwitch />
            {report && (
              <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5">
                <Download className="size-4" />
                خروجی CSV
              </Button>
            )}
          </div>
        }
      />

      {/* Filter Toolbar */}
      <Card className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchReport();
          }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 items-end"
        >
          <div className="grid gap-1">
            <Label htmlFor="fiscal-year">سال مالی</Label>
            <select
              id="fiscal-year"
              className={FIELD_CLASS}
              value={query.fiscalYearId ?? ""}
              onChange={(e) =>
                setQuery((curr) => ({
                  ...curr,
                  fiscalYearId: e.target.value ? Number(e.target.value) : undefined,
                }))
              }
            >
              <option value="">دوره دلخواه</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name} {y.status === "OPEN" ? "(جاری)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="date-from">از تاریخ</Label>
            <JalaliDateInput
              id="date-from"
              value={query.from ?? ""}
              onChange={(from) => setQuery((curr) => ({ ...curr, from: from || undefined }))}
            />
          </div>

          <div className="grid gap-1">
            <Label htmlFor="date-to">تا تاریخ</Label>
            <JalaliDateInput
              id="date-to"
              value={query.to ?? ""}
              onChange={(to) => setQuery((curr) => ({ ...curr, to: to || undefined }))}
            />
          </div>

          <div className="grid gap-1">
            <Label htmlFor="report-columns">ستون‌های تراز</Label>
            <select
              id="report-columns"
              className={FIELD_CLASS}
              value={query.columns ?? 6}
              onChange={(e) =>
                setQuery((curr) => ({
                  ...curr,
                  columns: Number(e.target.value) as TrialBalanceColumns,
                }))
              }
            >
              <option value={2}>۲ ستونی (مانده نهایی)</option>
              <option value={4}>۴ ستونی (گردش دوره و مانده)</option>
              <option value={6}>۶ ستونی (افتتاحیه، گردش دوره و مانده)</option>
              <option value={8}>۸ ستونی (افتتاحیه، گردش قبل، دوره و مانده)</option>
              <option value={10}>۱۰ ستونی (کامل با جمع گردش)</option>
            </select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="account-level">سطح حساب</Label>
            <select
              id="account-level"
              className={FIELD_CLASS}
              value={query.level ?? ""}
              onChange={(e) => setQuery((curr) => ({ ...curr, level: e.target.value || undefined }))}
            >
              <option value="">حساب‌های ثبت‌شده (پیش‌فرض)</option>
              <option value="KOL">سطح کل</option>
              <option value="MOAYAN">سطح معین</option>
              <option value="TAFSILI">سطح تفصیلی</option>
            </select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="cost-centre-code">کد مرکز هزینه خاص</Label>
            <div className="relative">
              <Input
                id="cost-centre-code"
                placeholder="مثلاً CC-100 یا خالی برای همه"
                value={query.costCenterCode ?? ""}
                onChange={(e) => setQuery((curr) => ({ ...curr, costCenterCode: e.target.value }))}
                className="h-9 pr-2 pl-8 font-mono text-xs"
              />
              <Building2 className="absolute left-2.5 top-2.5 size-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 sm:col-span-2 lg:col-span-4 xl:col-span-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(query.includeClosing)}
                onChange={(e) => setQuery((curr) => ({ ...curr, includeClosing: e.target.checked }))}
                className="size-4 rounded border-input"
              />
              <span>شامل اسناد بستن حساب‌ها (پایان دوره)</span>
            </label>

            <div className="mr-auto flex gap-2">
              <Button type="submit" size="sm" disabled={loading} className="gap-1.5">
                <Filter className="size-4" />
                اعمال فیلتر
              </Button>
            </div>
          </div>
        </form>
      </Card>

      {/* Summary Cards */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">تعداد مراکز هزینه</div>
            <div className="mt-1 text-2xl font-bold">{summary.totalCentres}</div>
            <div className="text-xs text-muted-foreground mt-1">ساختار درختی مراکز</div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-muted-foreground">سطوح حسابداری گزارش‌شده</div>
            <div className="mt-1 text-2xl font-bold">{summary.totalAccountRows}</div>
            <div className="text-xs text-muted-foreground mt-1">ردیف‌های گردش حساب</div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-muted-foreground">واحد مبالغ نمایش</div>
            <div className="mt-1 text-2xl font-bold">{UNIT_SUFFIX[unit]}</div>
            <div className="text-xs text-muted-foreground mt-1">بر اساس انتخاب کاربر</div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-muted-foreground">وضعیت تراز دفاتر</div>
            <div className="mt-2 flex items-center gap-2">
              {summary.isBalanced === true && (
                <Badge variant="default" className="bg-emerald-600 text-white gap-1 py-1">
                  <CheckCircle2 className="size-3.5" />
                  دفاتر متراز است
                </Badge>
              )}
              {summary.isBalanced === false && (
                <Badge variant="destructive" className="gap-1 py-1">
                  <AlertCircle className="size-3.5" />
                  اختلاف بدهکار و بستانکار
                </Badge>
              )}
              {summary.isBalanced === null && (
                <Badge variant="outline" className="gap-1 py-1">
                  تراز مقطعی (تک مرکز)
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              {summary.isBalanced === null
                ? "مراکز مستقل الزامی به برابری ندارند"
                : "کنترل جمع کل دوطرفه دفاتر"}
            </div>
          </Card>
        </div>
      )}

      {error && <ErrorNotice title="خطا در دریافت گزارش" message={error} />}
      <LoadingLine show={loading} />

      {/* Report Content */}
      {report && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Input
                placeholder="جستجو در نام یا کد مرکز و حساب‌ها..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-9 pr-9 text-xs"
              />
              <Search className="absolute right-2.5 top-2.5 size-4 text-muted-foreground pointer-events-none" />
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => toggleAll(true)} className="text-xs">
                باز کردن همه
              </Button>
              <Button variant="ghost" size="sm" onClick={() => toggleAll(false)} className="text-xs">
                بستن همه
              </Button>
            </div>
          </div>

          {filteredCentres.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              هیچ مرکز هزینه‌ای با مشخصات جستجو شده یافت نشد.
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredCentres.map((centre) => {
                const key = centre.code ?? "unassigned";
                const isExpanded = expandedCentres[key] ?? true;

                return (
                  <Card key={key} className="overflow-hidden border">
                    {/* Section Header */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleExpand(key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleExpand(key);
                        }
                      }}
                      className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 px-4 py-3 cursor-pointer hover:bg-muted/70 transition-colors select-none"
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronUp className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        )}
                        <span className="font-semibold text-sm">{formatCentreTitle(centre)}</span>
                        <Badge variant="outline" className="text-[11px] font-normal">
                          {getCentreDepthLabel(centre.depth)}
                        </Badge>
                        {centre.parentCode && (
                          <span className="text-xs text-muted-foreground font-mono">
                            زیرمجموعه: {centre.parentCode}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{centre.rows.length} حساب در گردش</span>
                      </div>
                    </div>

                    {/* Section Table */}
                    {isExpanded && (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader className="bg-muted/20">
                            <TableRow>
                              <TableHead className="w-24">کد حساب</TableHead>
                              <TableHead className="min-w-44">نام حساب</TableHead>
                              <TableHead className="w-20">سطح</TableHead>
                              {report.groups.flatMap((group) => [
                                <TableHead key={`${group}-d`} className="text-left min-w-28 text-xs">
                                  {TRIAL_BALANCE_GROUP_LABELS[group]} بدهکار
                                </TableHead>,
                                <TableHead key={`${group}-c`} className="text-left min-w-28 text-xs">
                                  {TRIAL_BALANCE_GROUP_LABELS[group]} بستانکار
                                </TableHead>,
                              ])}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {centre.rows.length === 0 ? (
                              <TableRow>
                                <TableCell
                                  colSpan={3 + report.groups.length * 2}
                                  className="h-16 text-center text-xs text-muted-foreground"
                                >
                                  هیچ ردیف گردشی در این بازه زمانی ثبت نشده است.
                                </TableCell>
                              </TableRow>
                            ) : (
                              centre.rows.map((row) => (
                                <TableRow key={row.code} className="hover:bg-muted/30">
                                  <TableCell className="font-mono text-xs font-medium">
                                    {row.code}
                                  </TableCell>
                                  <TableCell className="text-xs">{row.name}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {row.level ?? "—"}
                                  </TableCell>
                                  {renderGroupAmounts(row, report.groups)}
                                </TableRow>
                              ))
                            )}

                            {/* Section Subtotal Row */}
                            <TableRow className="font-bold bg-muted/30 border-t-2">
                              <TableCell />
                              <TableCell className="text-xs">
                                جمع مرکز: {centre.name}
                              </TableCell>
                              <TableCell />
                              {renderGroupAmounts(centre.totals, report.groups)}
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </Card>
                );
              })}

              {/* Grand Totals Card */}
              <Card className="overflow-hidden border-2 border-primary/30 mt-6">
                <div className="bg-primary/5 px-4 py-3 font-bold text-sm flex items-center justify-between">
                  <span>جمع کل دفاتر (بدون احتساب تکرار سطوح درختی)</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    مبالغ بر حسب {UNIT_SUFFIX[unit]}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/20">
                      <TableRow>
                        <TableHead className="w-24">عنوان</TableHead>
                        <TableHead className="min-w-44">شرح</TableHead>
                        <TableHead className="w-20" />
                        {report.groups.flatMap((group) => [
                          <TableHead key={`grand-${group}-d`} className="text-left min-w-28 text-xs font-bold">
                            {TRIAL_BALANCE_GROUP_LABELS[group]} بدهکار
                          </TableHead>,
                          <TableHead key={`grand-${group}-c`} className="text-left min-w-28 text-xs font-bold">
                            {TRIAL_BALANCE_GROUP_LABELS[group]} بستانکار
                          </TableHead>,
                        ])}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="font-bold text-sm bg-primary/5">
                        <TableCell className="font-mono">TOTAL</TableCell>
                        <TableCell>جمع نهایی دفاتر سازمان</TableCell>
                        <TableCell />
                        {renderGroupAmounts(report.totals, report.groups)}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CostCentresReportPage() {
  return (
    <EnterpriseRouteGuard>
      <Suspense fallback={<LoadingLine show={true} />}>
        <CostCentreTrialBalanceView />
      </Suspense>
    </EnterpriseRouteGuard>
  );
}
