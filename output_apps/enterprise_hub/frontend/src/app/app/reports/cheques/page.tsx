"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Banknote, Download } from "lucide-react";

import {
  ErrorNotice,
  LoadingLine,
  PageHeader,
  StatCard,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { BouncedReport } from "@/components/cheques/cheque-reports";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import { MoneyUnitSwitch } from "@/components/ui/money-unit-switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getChequeMaturityReport, listCheques } from "@/lib/api/cheques-client";
import {
  collectBankNames,
  csvSafeCell,
  filterPortfolioCheques,
  formatChequeMinorRial,
  summarizeByStatus,
} from "@/lib/cheques-report-ui";
import { statusesFor } from "@/lib/cheques-ui";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { useMoneyUnit } from "@/lib/money-unit";
import {
  DIRECTION_LABELS,
  SAYAD_REGISTRATION_LABELS,
  STATUS_LABELS,
  type Cheque,
  type ChequeDirection,
  type ChequeMaturityReport,
  type ChequeStatus,
  type SayadRegistrationStatus,
} from "@/types/cheques";

type ReportTab = "portfolio" | "register" | "bounced";

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function ChequePortfolioReportPage() {
  const [unit] = useMoneyUnit();
  const [tab, setTab] = useState<ReportTab>("portfolio");
  const [direction, setDirection] = useState<ChequeDirection | "all">("all");
  const [status, setStatus] = useState<ChequeStatus | "all">("all");
  const [bankName, setBankName] = useState<string>("");
  const [asOfDate, setAsOfDate] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const [maturity, setMaturity] = useState<ChequeMaturityReport | null>(null);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getChequeMaturityReport(
        {
          direction,
          asOfDate: asOfDate || undefined,
          bankName: bankName || undefined,
        },
        controller.signal,
      ),
      listCheques(
        {
          direction: direction === "all" ? undefined : direction,
          status: status === "all" ? undefined : status,
        },
        controller.signal,
      ),
    ])
      .then(([mat, list]) => {
        if (controller.signal.aborted) return;
        setMaturity(mat);
        setCheques(list);
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
  }, [direction, status, bankName, asOfDate]);

  const availableStatuses = useMemo(() => statusesFor(direction), [direction]);
  const bankOptions = useMemo(
    () => collectBankNames(cheques, maturity?.byBank ?? []),
    [cheques, maturity],
  );
  const filteredCheques = useMemo(
    () => filterPortfolioCheques(cheques, { direction, status, bankName, search }),
    [cheques, direction, status, bankName, search],
  );
  const statusSummary = useMemo(
    () => summarizeByStatus(filteredCheques),
    [filteredCheques],
  );

  function handleExportCsv() {
    const headers = [
      "شماره چک",
      "شناسه صیاد",
      "نوع",
      "طرف حساب",
      "بانک",
      "تاریخ صدور",
      "سررسید",
      "مبلغ (ریال)",
      "مانده (ریال)",
      "وضعیت",
    ];
    const rows = filteredCheques.map((c) => [
      csvSafeCell(c.chequeNumber),
      csvSafeCell(c.sayadNumber ?? ""),
      csvSafeCell(DIRECTION_LABELS[c.direction]),
      csvSafeCell(c.partyName),
      csvSafeCell(c.bankName ?? ""),
      csvSafeCell(c.issueDate),
      csvSafeCell(c.dueDate),
      csvSafeCell(c.amount),
      csvSafeCell(c.remainingAmount),
      csvSafeCell(STATUS_LABELS[c.direction][c.status]),
    ]);
    const csv = "\uFEFF" + [headers.map(csvSafeCell).join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cheques-portfolio.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <EnterpriseRouteGuard>
      <div className="flex min-w-0 flex-col gap-6">
        <PageHeader
          title="گزارش پرتفوی، سررسید و چک‌های برگشتی"
          description="تحلیل سبد چک‌های دریافتی و صادرشده به تفکیک بانک، وضعیت، سررسید و چک‌های برگشتی"
          icon={<Banknote className="size-6 text-primary" aria-hidden="true" />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <MoneyUnitSwitch />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={filteredCheques.length === 0}
              >
                <Download className="size-4" aria-hidden="true" />
                <span>خروجی CSV</span>
              </Button>
              <Link
                href="/app/cheques"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <ArrowRight className="size-4" aria-hidden="true" />
                <span>مدیریت چک‌ها</span>
              </Link>
            </div>
          }
        />

        <Card className="border border-border bg-card">
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="grid gap-1">
              <Label htmlFor="cheque-report-direction">جهت چک</Label>
              <select
                id="cheque-report-direction"
                value={direction}
                onChange={(e) => {
                  const next = e.target.value as ChequeDirection | "all";
                  setDirection(next);
                  setStatus("all");
                }}
                className={SELECT_CLASS}
              >
                <option value="all">همه (دریافتی و صادرشده)</option>
                <option value="received">دریافتی</option>
                <option value="issued">صادرشده</option>
              </select>
            </div>

            <div className="grid gap-1">
              <Label htmlFor="cheque-report-status">وضعیت چک</Label>
              <select
                id="cheque-report-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as ChequeStatus | "all")}
                className={SELECT_CLASS}
              >
                <option value="all">همه وضعیت‌ها</option>
                {availableStatuses.map((s) => (
                  <option key={s} value={s}>
                    {direction === "all"
                      ? `${STATUS_LABELS.received[s] !== "—" ? STATUS_LABELS.received[s] : STATUS_LABELS.issued[s]}`
                      : STATUS_LABELS[direction][s]}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1">
              <Label htmlFor="cheque-report-bank">بانک</Label>
              <select
                id="cheque-report-bank"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">همه بانک‌ها</option>
                {bankOptions.map((bank) => (
                  <option key={bank} value={bank}>
                    {bank}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1">
              <Label htmlFor="cheque-report-asof">تاریخ مبنا</Label>
              <JalaliDateInput
                id="cheque-report-asof"
                value={asOfDate}
                onChange={setAsOfDate}
              />
            </div>

            <div className="grid gap-1">
              <Label htmlFor="cheque-report-search">جستجو</Label>
              <Input
                id="cheque-report-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="طرف‌حساب، شماره چک یا صیاد..."
                className="h-9"
              />
            </div>
          </CardContent>
        </Card>

        <ErrorNotice title="خطا در دریافت گزارش چک‌ها" message={error} />
        <LoadingLine show={loading} />

        <div role="tablist" aria-label="نمای گزارش چک" className="flex flex-wrap gap-2">
          <Button
            type="button"
            role="tab"
            aria-selected={tab === "portfolio"}
            variant={tab === "portfolio" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("portfolio")}
          >
            تحلیل پرتفوی و سررسید
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={tab === "register"}
            variant={tab === "register" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("register")}
          >
            دفتر چک‌ها ({formatNumber(filteredCheques.length)})
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={tab === "bounced"}
            variant={tab === "bounced" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("bounced")}
          >
            چک‌های برگشتی
          </Button>
        </div>

        {tab === "portfolio" && maturity && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="کل پرتفوی باز"
                value={formatChequeMinorRial(maturity.summary.totalAmountMinor, unit)}
                hint={`${formatNumber(maturity.summary.totalCount)} فقره · میانگین وزنی ${formatNumber(maturity.summary.weightedAverageDays)} روز`}
              />
              <StatCard
                label="سررسیدگذشته (معوق)"
                value={formatChequeMinorRial(maturity.summary.overdueAmountMinor, unit)}
                hint={`${formatNumber(maturity.summary.overdueCount)} فقره چک`}
              />
              <StatCard
                label="سررسید امروز"
                value={formatChequeMinorRial(maturity.summary.todayAmountMinor, unit)}
                hint={`${formatNumber(maturity.summary.todayCount)} فقره چک`}
              />
              <StatCard
                label="سررسید آتی"
                value={formatChequeMinorRial(maturity.summary.upcomingAmountMinor, unit)}
                hint={`${formatNumber(maturity.summary.upcomingCount)} فقره چک`}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="border border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-base">تفکیک پرتفوی بر اساس بانک</CardTitle>
                </CardHeader>
                <CardContent>
                  {maturity.byBank.length === 0 ? (
                    <p className="text-sm text-muted-foreground">چک بازی برای نمایش وجود ندارد.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>بانک</TableHead>
                          <TableHead>تعداد</TableHead>
                          <TableHead>مبلغ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {maturity.byBank.map((row) => (
                          <TableRow key={row.bankName}>
                            <TableCell className="font-medium">{row.bankName}</TableCell>
                            <TableCell className="num tabular-nums">{formatNumber(row.count)}</TableCell>
                            <TableCell className="num tabular-nums">
                              {formatChequeMinorRial(row.totalAmountMinor, unit)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card className="border border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-base">طرف‌حساب‌های دارای بیشترین مانده چک</CardTitle>
                </CardHeader>
                <CardContent>
                  {maturity.topParties.length === 0 ? (
                    <p className="text-sm text-muted-foreground">رکوردی ثبت نشده است.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>طرف حساب</TableHead>
                          <TableHead>تعداد</TableHead>
                          <TableHead>مبلغ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {maturity.topParties.map((row) => (
                          <TableRow key={`${row.partyCode ?? ""}-${row.partyName}`}>
                            <TableCell className="font-medium">{row.partyName}</TableCell>
                            <TableCell className="num tabular-nums">{formatNumber(row.count)}</TableCell>
                            <TableCell className="num tabular-nums">
                              {formatChequeMinorRial(row.totalAmountMinor, unit)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="border border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-base">بندی زمانی سررسیدها</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>بازه سررسید</TableHead>
                        <TableHead>تعداد</TableHead>
                        <TableHead>جمع مبلغ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.values(maturity.buckets).map((bucket) => (
                        <TableRow key={bucket.bucketKey}>
                          <TableCell>{bucket.labelFa}</TableCell>
                          <TableCell className="num tabular-nums">{formatNumber(bucket.count)}</TableCell>
                          <TableCell className="num tabular-nums">
                            {formatChequeMinorRial(bucket.totalAmountMinor, unit)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card className="border border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-base">وضعیت ثبت در سامانه صیاد</CardTitle>
                </CardHeader>
                <CardContent>
                  {Object.keys(maturity.bySayadStatus).length === 0 ? (
                    <p className="text-sm text-muted-foreground">موردی یافت نشد.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>وضعیت صیاد</TableHead>
                          <TableHead>تعداد</TableHead>
                          <TableHead>جمع مبلغ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(maturity.bySayadStatus).map(([key, agg]) => (
                          <TableRow key={key}>
                            <TableCell>
                              {SAYAD_REGISTRATION_LABELS[key as SayadRegistrationStatus] ?? key}
                            </TableCell>
                            <TableCell className="num tabular-nums">{formatNumber(agg.count)}</TableCell>
                            <TableCell className="num tabular-nums">
                              {formatChequeMinorRial(agg.totalAmountMinor, unit)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {tab === "register" && (
          <div className="flex flex-col gap-4">
            {statusSummary.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {statusSummary.map((s) => (
                  <StatCard
                    key={s.status}
                    label={
                      direction === "all"
                        ? STATUS_LABELS.received[s.status] !== "—"
                          ? STATUS_LABELS.received[s.status]
                          : STATUS_LABELS.issued[s.status]
                        : STATUS_LABELS[direction][s.status]
                    }
                    value={formatMoneyRial(s.totalRial, unit)}
                    hint={`${formatNumber(s.count)} فقره چک`}
                  />
                ))}
              </div>
            )}

            <Card className="border border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base">فهرست چک‌ها بر اساس فیلتر</CardTitle>
              </CardHeader>
              <CardContent>
                {filteredCheques.length === 0 ? (
                  <p className="text-sm text-muted-foreground">چکی با این فیلترها یافت نشد.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>شماره چک</TableHead>
                        <TableHead>نوع</TableHead>
                        <TableHead>طرف حساب</TableHead>
                        <TableHead>بانک</TableHead>
                        <TableHead>سررسید</TableHead>
                        <TableHead>مبلغ کل</TableHead>
                        <TableHead>مانده</TableHead>
                        <TableHead>وضعیت</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCheques.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell dir="ltr" className="num text-start tabular-nums">
                            {c.chequeNumber}
                          </TableCell>
                          <TableCell>{DIRECTION_LABELS[c.direction]}</TableCell>
                          <TableCell>{c.partyName}</TableCell>
                          <TableCell>{c.bankName ?? "—"}</TableCell>
                          <TableCell>{formatJalaliDate(c.dueDate)}</TableCell>
                          <TableCell className="num tabular-nums">
                            {formatMoneyRial(c.amount, unit)}
                          </TableCell>
                          <TableCell className="num tabular-nums">
                            {formatMoneyRial(c.remainingAmount, unit)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={c.status === "bounced" ? "destructive" : "secondary"}>
                              {STATUS_LABELS[c.direction][c.status]}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "bounced" && <BouncedReport />}
      </div>
    </EnterpriseRouteGuard>
  );
}
