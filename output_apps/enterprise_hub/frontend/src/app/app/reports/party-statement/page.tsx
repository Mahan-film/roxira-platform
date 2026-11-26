"use client";

import { useEffect, useState } from "react";
import { FileSpreadsheet, FileText, Loader2, Users } from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  downloadReport,
  getPartyStatement,
  listFiscalYears,
} from "@/lib/api/accounting-reports-client";
import { formatMoneyRial } from "@/lib/fa-format";
import type {
  FiscalYear,
  PartyStatementReport,
  PartyStatementSide,
} from "@/types/accounting-reports";

export default function PartyStatementPage() {
  const [partyCode, setPartyCode] = useState("");
  const [side, setSide] = useState<PartyStatementSide>("receivable");
  const [accountCode, setAccountCode] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [years, setYears] = useState<FiscalYear[]>([]);

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PartyStatementReport | null>(null);

  useEffect(() => {
    listFiscalYears()
      .then((list) => {
        setYears(list);
        if (list.length > 0) {
          setFiscalYearId(String(list[0].id));
        }
      })
      .catch(() => {
        // Fiscal years optional when explicit dates are used
      });
  }, []);

  function buildParams() {
    return {
      partyCode: partyCode.trim(),
      side,
      accountCode: accountCode.trim() || undefined,
      fiscalYearId: fiscalYearId ? Number(fiscalYearId) : undefined,
      from: fromDate.trim() || undefined,
      to: toDate.trim() || undefined,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyCode.trim()) {
      setError("کد طرف حساب الزامی است.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getPartyStatement(buildParams());
      setReport(data);
    } catch (err) {
      setError(loadErrorMessage(err));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport(format: "xlsx" | "pdf") {
    if (!partyCode.trim()) {
      setError("کد طرف حساب الزامی است.");
      return;
    }
    setExporting(format);
    setError(null);
    try {
      await downloadReport("party-statement", format, buildParams());
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setExporting(null);
    }
  }

  const totalDebit =
    report?.ledger.rows.reduce((sum, r) => sum + BigInt(r.debit), 0n) ?? 0n;
  const totalCredit =
    report?.ledger.rows.reduce((sum, r) => sum + BigInt(r.credit), 0n) ?? 0n;

  return (
    <EnterpriseRouteGuard>
      <div className="space-y-6">
        <PageHeader
          title="صورت‌حساب طرف حساب"
          description="گردش حساب مشتری یا تأمین‌کننده با مانده در لحظه، جدول سنی و خروجی Excel/PDF"
          icon={Users}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">فیلترهای گزارش</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              <div className="space-y-1.5">
                <Label htmlFor="partyCode">کد طرف حساب</Label>
                <Input
                  id="partyCode"
                  value={partyCode}
                  onChange={(e) => setPartyCode(e.target.value)}
                  placeholder="مثلاً C-101"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="side">نوع حساب</Label>
                <select
                  id="side"
                  value={side}
                  onChange={(e) => setSide(e.target.value as PartyStatementSide)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
                >
                  <option value="receivable">دریافتنی (مشتری)</option>
                  <option value="payable">پرداختنی (تأمین‌کننده)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fiscalYearId">سال مالی</Label>
                <select
                  id="fiscalYearId"
                  value={fiscalYearId}
                  onChange={(e) => setFiscalYearId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
                >
                  <option value="">بازه دلخواه</option>
                  {years.map((y) => (
                    <option key={y.id} value={String(y.id)}>
                      {y.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fromDate">از تاریخ (میلادی / جلالی ISO)</Label>
                <Input
                  id="fromDate"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  placeholder="2026-03-21"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="toDate">تا تاریخ</Label>
                <Input
                  id="toDate"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  placeholder="2027-03-20"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="accountCode">کد حساب (اختیاری)</Label>
                <Input
                  id="accountCode"
                  value={accountCode}
                  onChange={(e) => setAccountCode(e.target.value)}
                  placeholder="مثلاً 1103"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-6">
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="me-2 size-4 animate-spin" />}
                  نمایش صورت‌حساب
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={exporting !== null || !partyCode.trim()}
                  onClick={() => handleExport("xlsx")}
                >
                  <FileSpreadsheet className="me-2 size-4" />
                  خروجی Excel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={exporting !== null || !partyCode.trim()}
                  onClick={() => handleExport("pdf")}
                >
                  <FileText className="me-2 size-4" />
                  خروجی PDF
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {error && <ErrorNotice message={error} />}
        {loading && <LoadingLine label="در حال دریافت صورت‌حساب..." />}

        {report && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">مانده ابتدای دوره</CardTitle>
                </CardHeader>
                <CardContent className="text-lg font-semibold">
                  {formatMoneyRial(report.ledger.opening)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">جمع بدهکار</CardTitle>
                </CardHeader>
                <CardContent className="text-lg font-semibold">
                  {formatMoneyRial(totalDebit)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">جمع بستانکار</CardTitle>
                </CardHeader>
                <CardContent className="text-lg font-semibold">
                  {formatMoneyRial(totalCredit)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">مانده پایان دوره</CardTitle>
                </CardHeader>
                <CardContent className="text-lg font-semibold">
                  {formatMoneyRial(report.ledger.closing)}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">گردش حساب با مانده در لحظه</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>تاریخ</TableHead>
                      <TableHead>شماره سند</TableHead>
                      <TableHead>شرح</TableHead>
                      <TableHead>بدهکار</TableHead>
                      <TableHead>بستانکار</TableHead>
                      <TableHead>مانده</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.ledger.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          گردشی در این بازه ثبت نشده است.
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.ledger.rows.map((row, idx) => (
                        <TableRow key={`${row.entryNumber}-${idx}`}>
                          <TableCell className="whitespace-nowrap">{row.entryDate}</TableCell>
                          <TableCell className="whitespace-nowrap">{row.entryNumber}</TableCell>
                          <TableCell>{row.description || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatMoneyRial(row.debit)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatMoneyRial(row.credit)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-medium">
                            {formatMoneyRial(row.balance)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {report.ageing.rows.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">جدول سنی مانده باز</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>طرف حساب</TableHead>
                        {report.ageing.labels.map((label) => (
                          <TableHead key={label}>{label}</TableHead>
                        ))}
                        <TableHead>جمع</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.ageing.rows.map((row) => (
                        <TableRow key={row.partyCode}>
                          <TableCell>{row.partyName || row.partyCode}</TableCell>
                          {row.buckets.map((bucket, idx) => (
                            <TableCell key={idx} className="whitespace-nowrap">
                              {formatMoneyRial(bucket)}
                            </TableCell>
                          ))}
                          <TableCell className="whitespace-nowrap font-medium">
                            {formatMoneyRial(row.total)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </EnterpriseRouteGuard>
  );
}
