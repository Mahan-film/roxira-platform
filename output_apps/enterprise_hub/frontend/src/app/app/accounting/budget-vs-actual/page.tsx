"use client";

import { useEffect, useState } from "react";
import { PieChart, Plus, RefreshCw, X } from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyUnitSwitch } from "@/components/ui/money-unit-switch";
import {
  BudgetVsActualReport,
  getBudgetVsActual,
  listFiscalYears,
  setAccountBudget,
} from "@/lib/api/accounting-reports-client";
import { formatMoneyRial } from "@/lib/fa-format";
import type { FiscalYear } from "@/types/accounting-reports";

export default function BudgetVsActualPage() {
  return (
    <EnterpriseRouteGuard>
      <BudgetVsActualContent />
    </EnterpriseRouteGuard>
  );
}

function BudgetVsActualContent() {
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [costCenterCode, setCostCenterCode] = useState<string>("");
  const [report, setReport] = useState<BudgetVsActualReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Set budget panel state
  const [showSetBudget, setShowSetBudget] = useState(false);
  const [budgetAccountCode, setBudgetAccountCode] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFiscalYears()
      .then((years) => {
        if (cancelled) return;
        setFiscalYears(years);
        if (years.length > 0) {
          const current = years.find((y) => !y.closedAt) ?? years[0];
          setSelectedYearId(current.id);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(loadErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadReport = () => {
    if (!selectedYearId) return;
    setLoading(true);
    setError(null);
    getBudgetVsActual({
      fiscalYearId: selectedYearId,
      costCenterCode: costCenterCode.trim() || undefined,
    })
      .then((data) => setReport(data))
      .catch((err) => setError(loadErrorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (selectedYearId) {
      loadReport();
    }
  }, [selectedYearId, costCenterCode]);

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedYearId || !budgetAccountCode.trim() || !budgetAmount.trim()) return;
    setSavingBudget(true);
    setSaveError(null);
    try {
      await setAccountBudget({
        fiscalYearId: selectedYearId,
        accountCode: budgetAccountCode.trim(),
        budgetAmount: budgetAmount.trim(),
      });
      setShowSetBudget(false);
      setBudgetAccountCode("");
      setBudgetAmount("");
      loadReport();
    } catch (err) {
      setSaveError(loadErrorMessage(err));
    } finally {
      setSavingBudget(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="گزارش بودجه در برابر عملکرد"
          description="مقایسه سقف بودجه مصوب با هزینه‌ها و درآمدهای واقعی ثبت‌شده در سال مالی"
          icon={<PieChart className="h-6 w-6 text-primary" />}
        />
        <div className="flex items-center gap-3">
          <MoneyUnitSwitch />
          <Button
            size="sm"
            variant={showSetBudget ? "secondary" : "default"}
            onClick={() => setShowSetBudget(!showSetBudget)}
            className="gap-2"
          >
            {showSetBudget ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showSetBudget ? "بستن فرم" : "تنظیم سقف بودجه"}
          </Button>
        </div>
      </div>

      {/* Set budget form panel */}
      {showSetBudget && (
        <Card className="border-primary/40 bg-card p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold">ثبت و به‌روزرسانی سقف بودجه حساب</h3>
          <form onSubmit={handleSaveBudget} className="space-y-4">
            {saveError && <ErrorNotice title="خطا در ثبت بودجه" message={saveError} />}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="account-code">کد حساب (معین یا تفصیلی)</Label>
                <Input
                  id="account-code"
                  value={budgetAccountCode}
                  onChange={(e) => setBudgetAccountCode(e.target.value)}
                  placeholder="مثلاً 5020"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget-amount">مبلغ سقف بودجه (ریال)</Label>
                <Input
                  id="budget-amount"
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                  placeholder="مبلغ به ریال"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowSetBudget(false)}>
                انصراف
              </Button>
              <Button type="submit" disabled={savingBudget}>
                {savingBudget ? "در حال ذخیره..." : "ثبت سقف بودجه"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="fiscal-year-select">سال مالی</Label>
            <select
              id="fiscal-year-select"
              value={selectedYearId ?? ""}
              onChange={(e) => setSelectedYearId(Number(e.target.value))}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {fiscalYears.map((fy) => (
                <option key={fy.id} value={fy.id}>
                  {fy.name} {fy.closedAt ? "(بسته)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cost-center-code">کد مرکز هزینه (اختیاری)</Label>
            <Input
              id="cost-center-code"
              value={costCenterCode}
              onChange={(e) => setCostCenterCode(e.target.value)}
              placeholder="مثلاً CC-100"
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={loadReport} disabled={loading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              به‌روزرسانی
            </Button>
          </div>
        </div>
      </Card>

      {error && <ErrorNotice title="خطا در دریافت گزارش" message={error} />}
      <LoadingLine show={loading} />

      {/* Summary KPI Cards */}
      {report && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Card className="p-4 text-center">
            <div className="text-sm text-muted-foreground">مجموع بودجه مصوب</div>
            <div className="mt-2 text-xl font-bold">{formatMoneyRial(report.totalBudget)}</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-sm text-muted-foreground">عملکرد واقعی</div>
            <div className="mt-2 text-xl font-bold">{formatMoneyRial(report.totalActual)}</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-sm text-muted-foreground">مانده بودجه (انحراف)</div>
            <div className={`mt-2 text-xl font-bold ${Number(report.totalVariance) < 0 ? "text-destructive" : "text-emerald-600"}`}>
              {formatMoneyRial(report.totalVariance)}
            </div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-sm text-muted-foreground">درصد مصرف کل</div>
            <div className="mt-2 text-xl font-bold">
              {report.overallUtilizationPercent !== null ? `%${report.overallUtilizationPercent}` : "—"}
            </div>
          </Card>
        </div>
      )}

      {/* Report Rows Table */}
      {report && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b bg-muted/50 text-xs font-semibold text-muted-foreground">
                <tr>
                  <th className="p-3">کد حساب</th>
                  <th className="p-3">عنوان حساب</th>
                  <th className="p-3">مرکز هزینه</th>
                  <th className="p-3">سقف بودجه</th>
                  <th className="p-3">عملکرد واقعی</th>
                  <th className="p-3">انحراف بودجه</th>
                  <th className="p-3">درصد مصرف</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      هیچ رکوردی برای بودجه این سال مالی ثبت نشده است. با دکمه «تنظیم سقف بودجه» سقف مورد نظر را وارد کنید.
                    </td>
                  </tr>
                ) : (
                  report.rows.map((row, idx) => {
                    const isOver = row.utilizationPercent !== null && row.utilizationPercent > 100;
                    return (
                      <tr key={idx} className="hover:bg-muted/30">
                        <td className="p-3 font-mono font-medium">{row.accountCode}</td>
                        <td className="p-3">{row.accountName}</td>
                        <td className="p-3 text-muted-foreground">
                          {row.costCenterCode ? `${row.costCenterCode} - ${row.costCenterName}` : "—"}
                        </td>
                        <td className="p-3 font-medium">{formatMoneyRial(row.budgetAmount)}</td>
                        <td className="p-3 font-medium">{formatMoneyRial(row.actualAmount)}</td>
                        <td className={`p-3 font-medium ${Number(row.varianceAmount) < 0 ? "text-destructive font-bold" : ""}`}>
                          {formatMoneyRial(row.varianceAmount)}
                        </td>
                        <td className="p-3">
                          {row.utilizationPercent !== null ? (
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                                isOver ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
                              }`}
                            >
                              %{row.utilizationPercent}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
