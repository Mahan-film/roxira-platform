"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Download, Filter, RefreshCw, Layers } from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { getConsolidatedReport } from "@/lib/api/accounting-reports-client";
import type {
  ConsolidatedAccountRow,
  ConsolidatedReportResponse,
  ConsolidatedTenantSummary,
} from "@/types/accounting-reports";

export default function ConsolidatedReportPage() {
  const [asOfDate, setAsOfDate] = useState<string>("");
  const [report, setReport] = useState<ConsolidatedReportResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = (date?: string) => {
    setLoading(true);
    setError(null);
    getConsolidatedReport({ asOfDate: date || undefined })
      .then((res) => {
        setReport(res);
        if (res.asOfDate && !asOfDate) {
          setAsOfDate(res.asOfDate);
        }
      })
      .catch((err) => {
        setError(err.message || "خطا در دریافت گزارش تجمیعی چند شرکت");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchReport();
  }, []);

  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="گزارش تجمیعی چند شرکت (هلدینگ)"
        description="تراز تجمیعی و صورت‌های مالی یکپارچه در سطح تمام شرکت‌ها و سازمان‌های تحت مدیریت کاربر"
        icon={<Building2 className="size-6 text-indigo-600" />}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/app/accounting/reports"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowRight className="size-4" />
              بازگشت به گزارش‌ها
            </Link>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Filter Bar */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5 w-60">
                <Label htmlFor="asOfDate">تا تاریخ (مبنای گزارش)</Label>
                <JalaliDateInput
                  id="asOfDate"
                  value={asOfDate}
                  onChange={(val) => setAsOfDate(val || "")}
                />
              </div>

              <Button
                variant="default"
                size="sm"
                onClick={() => fetchReport(asOfDate)}
                disabled={loading}
              >
                <RefreshCw className={`size-4 ml-1.5 ${loading ? "animate-spin" : ""}`} />
                محاسبه تراز تجمیعی
              </Button>
            </div>
          </CardContent>
        </Card>

        {error && <ErrorNotice title="خطا در گزارش تجمیعی" message={error} />}
        <LoadingLine show={loading} />

        {/* Participating Companies */}
        {report && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Layers className="size-4" />
                شرکت‌های حاضر در گزارش تجمیعی:
              </span>
              {report.participatingTenants.map((tenant: ConsolidatedTenantSummary) => (
                <Badge key={tenant.tenantId} variant="secondary" className="px-2.5 py-1 text-xs">
                  {tenant.tenantName}
                </Badge>
              ))}
            </div>

            {/* Grand Summary Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    مجموع بدهکار کل هلدینگ
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold font-mono text-foreground">
                    {formatMoneyRial(report.grandTotalDebit)}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    مجموع بستانکار کل هلدینگ
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold font-mono text-foreground">
                    {formatMoneyRial(report.grandTotalCredit)}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    مانده نهایی تجمیعی
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className={`text-xl font-bold font-mono ${
                      report.grandNetBalance === 0
                        ? "text-emerald-600"
                        : "text-foreground"
                    }`}
                  >
                    {formatMoneyRial(report.grandNetBalance)}
                  </div>
                  {report.grandTotalDebit === report.grandTotalCredit && (
                    <span className="text-xs text-emerald-600 mt-1 inline-block">
                      تراز تجمیعی متعادل و متوازن است ✓
                    </span>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Consolidated Trial Balance Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  تراز آزمایشی کل دفاتر تجمیعی ({report.rows.length} حساب)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24 text-right">کد حساب</TableHead>
                        <TableHead className="text-right">عنوان حساب</TableHead>
                        {report.participatingTenants.map((t) => (
                          <TableHead key={t.tenantId} className="text-left font-mono text-xs">
                            مانده {t.tenantName}
                          </TableHead>
                        ))}
                        <TableHead className="w-40 text-left font-mono">جمع بدهکار (ریال)</TableHead>
                        <TableHead className="w-40 text-left font-mono">جمع بستانکار (ریال)</TableHead>
                        <TableHead className="w-40 text-left font-mono">مانده تجمیعی</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.rows.map((row: ConsolidatedAccountRow) => (
                        <TableRow key={row.accountCode}>
                          <TableCell className="font-mono text-sm">{row.accountCode}</TableCell>
                          <TableCell className="font-medium">{row.accountName}</TableCell>
                          {report.participatingTenants.map((t) => {
                            const co = row.companyAmounts[t.tenantId];
                            const balance = co ? co.balance : 0;
                            return (
                              <TableCell
                                key={t.tenantId}
                                className={`text-left font-mono text-xs ${
                                  balance > 0 ? "text-blue-600" : balance < 0 ? "text-amber-600" : "text-muted-foreground"
                                }`}
                              >
                                {balance !== 0 ? formatMoneyRial(balance) : "-"}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-left font-mono">
                            {formatMoneyRial(row.totalDebit)}
                          </TableCell>
                          <TableCell className="text-left font-mono">
                            {formatMoneyRial(row.totalCredit)}
                          </TableCell>
                          <TableCell
                            className={`text-left font-mono font-semibold ${
                              Number(row.netBalance) > 0
                                ? "text-blue-700"
                                : Number(row.netBalance) < 0
                                  ? "text-amber-700"
                                  : ""
                            }`}
                          >
                            {formatMoneyRial(row.netBalance)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </EnterpriseRouteGuard>
  );
}
