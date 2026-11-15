"use client";

import { useState, type FormEvent } from "react";
import { FileSpreadsheet, RefreshCw, Search, ShieldAlert, Upload } from "lucide-react";

import { useAccess } from "@/components/app/access-provider";
import { ErrorNotice, LoadingLine, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { reconcileKartable } from "@/lib/api/kartable-recon-client";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import {
  BUCKET_LABELS,
  MATCH_BY_LABELS,
  QUARTER_OPTIONS,
  SECTION_LABELS,
  filterReconRows,
  isNonZeroAmount,
  type ReconBucketFilter,
  type ReconSectionFilter,
} from "@/lib/kartable-recon-ui";
import type {
  KartableBucket,
  KartableReconciliationResponse,
} from "@/types/kartable-reconciliation";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm";

function bucketBadgeVariant(
  bucket: KartableBucket,
): "default" | "secondary" | "destructive" | "outline" {
  switch (bucket) {
    case "matched":
      return "default";
    case "amount_difference":
      return "secondary";
    case "missing_in_our_system":
    case "missing_in_kartable":
      return "destructive";
  }
}

export default function KartableReconciliationPage() {
  const { can, loading: accessLoading } = useAccess();
  const canReconcile = can("tax", "create");

  const [yearInput, setYearInput] = useState<string>("1405");
  const [quarter, setQuarter] = useState<number>(1);
  const [salesFile, setSalesFile] = useState<File | null>(null);
  const [purchasesFile, setPurchasesFile] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KartableReconciliationResponse | null>(null);

  const [bucketFilter, setBucketFilter] = useState<ReconBucketFilter>("all");
  const [sectionFilter, setSectionFilter] = useState<ReconSectionFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canReconcile || busy) return;
    const parsedYear = Number(yearInput.trim());
    if (!Number.isInteger(parsedYear) || parsedYear < 1300 || parsedYear > 1600) {
      setError("لطفاً سال شمسی معتبر (عدد صحیح بین ۱۳۰۰ تا ۱۶۰۰) وارد کنید.");
      return;
    }
    if (!salesFile && !purchasesFile) {
      setError("حداقل یکی از فایل‌های کارپوشه فروش یا خرید (CSV یا XLSX) را انتخاب کنید.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await reconcileKartable({
        year: parsedYear,
        quarter,
        salesFile,
        purchasesFile,
      });
      setResult(res);
      setBucketFilter("all");
      setSectionFilter("all");
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const filteredRows = result
    ? filterReconRows(result.rows, bucketFilter, sectionFilter, searchQuery)
    : [];

  return (
    <EnterpriseRouteGuard>
      <div className="space-y-6" dir="rtl">
        <PageHeader
          title="تطبیق کارپوشه سامانه مودیان"
          description="بارگذاری فایل خروجی فروش و خرید کارپوشه (CSV / XLSX) و تطبیق خودکار با فاکتورهای ثبت‌شده بر اساس شماره مالیاتی، شماره صورتحساب و مبلغ با محاسبه جمع مالیات بر ارزش افزوده فصل."
        />

        {accessLoading ? (
          <LoadingLine show={accessLoading} />
        ) : !canReconcile ? (
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>دسترسی مجاز نیست</AlertTitle>
            <AlertDescription>
              برای بارگذاری و اجرای تطبیق کارپوشه مودیان به دسترسی ثبت در ماژول مالیات نیاز دارید.
            </AlertDescription>
          </Alert>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Upload className="h-4 w-4" />
                بارگذاری خروجی کارپوشه برای دوره فصلی
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-4">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">سال شمسی</span>
                  <Input
                    type="number"
                    min={1300}
                    max={1600}
                    value={yearInput}
                    onChange={(e) => setYearInput(e.target.value)}
                  />
                </label>

                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">فصل مالیاتی</span>
                  <select
                    className={`${selectClass} w-full`}
                    value={quarter}
                    onChange={(e) => setQuarter(Number(e.target.value))}
                  >
                    {QUARTER_OPTIONS.map((q) => (
                      <option key={q.value} value={q.value}>
                        {q.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">فایل فروش کارپوشه (CSV / XLSX)</span>
                  <Input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) => setSalesFile(e.target.files?.[0] ?? null)}
                  />
                  {salesFile && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {salesFile.name}
                    </span>
                  )}
                </label>

                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">فایل خرید کارپوشه (CSV / XLSX)</span>
                  <Input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) => setPurchasesFile(e.target.files?.[0] ?? null)}
                  />
                  {purchasesFile && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {purchasesFile.name}
                    </span>
                  )}
                </label>

                <div className="flex items-center gap-3 md:col-span-4">
                  <Button type="submit" disabled={busy}>
                    <RefreshCw className={`me-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
                    {busy ? "در حال تطبیق…" : "شروع تطبیق کارپوشه"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setSalesFile(null);
                      setPurchasesFile(null);
                      setError(null);
                    }}
                  >
                    پاک کردن فایل‌ها
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {error && <ErrorNotice title="خطا در تطبیق کارپوشه" message={error} />}

        {result && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    جمع مالیات فروش ({result.period.label})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>سیستم ما:</span>
                    <span className="font-semibold">
                      {formatMoneyRial(result.quarterlyVat.our.salesVat)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>کارپوشه:</span>
                    <span className="font-semibold">
                      {formatMoneyRial(result.quarterlyVat.kartable.salesVat)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-1">
                    <span>اختلاف:</span>
                    <span className="font-semibold">
                      {formatMoneyRial(result.quarterlyVat.diff.salesVat)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    جمع مالیات خرید ({result.period.label})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>سیستم ما:</span>
                    <span className="font-semibold">
                      {formatMoneyRial(result.quarterlyVat.our.purchasesVat)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>کارپوشه:</span>
                    <span className="font-semibold">
                      {formatMoneyRial(result.quarterlyVat.kartable.purchasesVat)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-1">
                    <span>اختلاف:</span>
                    <span className="font-semibold">
                      {formatMoneyRial(result.quarterlyVat.diff.purchasesVat)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    خالص ارزش افزوده قابل پرداخت فصل
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>سیستم ما:</span>
                    <span className="font-semibold">
                      {formatMoneyRial(result.quarterlyVat.our.netVatPayable)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>کارپوشه:</span>
                    <span className="font-semibold">
                      {formatMoneyRial(result.quarterlyVat.kartable.netVatPayable)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-1">
                    <span>اختلاف خالص:</span>
                    <span className="font-semibold">
                      {formatMoneyRial(result.quarterlyVat.diff.netVatPayable)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {([
                { key: "SALE", title: "خلاصه بخش فروش", data: result.sales },
                { key: "PURCHASE", title: "خلاصه بخش خرید", data: result.purchases },
              ] as const).map((sec) => (
                <Card key={sec.key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4" />
                        {sec.title}
                      </span>
                      <Badge variant={sec.data.uploaded ? "default" : "outline"}>
                        {sec.data.uploaded
                          ? `${sec.data.fileName ?? "فایل"} (${sec.data.formatId ?? ""})`
                          : "بارگذاری نشده"}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 text-xs">
                    <div>تطبیق کامل: {formatNumber(sec.data.matchedCount)}</div>
                    <div>اختلاف مبلغ: {formatNumber(sec.data.amountDifferenceCount)}</div>
                    <div>کسری در سیستم ما: {formatNumber(sec.data.missingInOurSystemCount)}</div>
                    <div>کسری در کارپوشه: {formatNumber(sec.data.missingInKartableCount)}</div>
                    <div>فاکتورهای ما در فصل: {formatNumber(sec.data.ourInvoiceCount)}</div>
                    <div>ردیف‌های کارپوشه در فصل: {formatNumber(sec.data.kartableRowCount)}</div>
                    {sec.data.outOfPeriodSkippedCount > 0 && (
                      <div className="col-span-2 text-amber-600">
                        ردیف‌های خارج از فصل انتخاب‌شده (صرف‌نظر شد):{" "}
                        {formatNumber(sec.data.outOfPeriodSkippedCount)}
                      </div>
                    )}
                    {sec.data.undatedSkippedCount > 0 && (
                      <div className="col-span-2 text-amber-600">
                        ردیف‌های بدون تاریخ معتبر در کارپوشه (در جمع محاسبه نشد):{" "}
                        {formatNumber(sec.data.undatedSkippedCount)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader className="space-y-3">
                <CardTitle className="text-base">
                  نتایج تطبیق ردیف به ردیف ({formatNumber(filteredRows.length)} ردیف)
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={bucketFilter === "all" ? "default" : "outline"}
                    onClick={() => setBucketFilter("all")}
                  >
                    همه ({formatNumber(result.rows.length)})
                  </Button>
                  {(
                    [
                      "matched",
                      "amount_difference",
                      "missing_in_our_system",
                      "missing_in_kartable",
                    ] as const
                  ).map((bucket) => {
                    const count = result.rows.filter((r) => r.bucket === bucket).length;
                    return (
                      <Button
                        key={bucket}
                        type="button"
                        size="sm"
                        variant={bucketFilter === bucket ? "default" : "outline"}
                        onClick={() => setBucketFilter(bucket)}
                      >
                        {BUCKET_LABELS[bucket]} ({formatNumber(count)})
                      </Button>
                    );
                  })}

                  <select
                    aria-label="فیلتر بخش"
                    className={selectClass}
                    value={sectionFilter}
                    onChange={(e) => setSectionFilter(e.target.value as ReconSectionFilter)}
                  >
                    <option value="all">فروش و خرید</option>
                    <option value="SALE">فقط فروش</option>
                    <option value="PURCHASE">فقط خرید</option>
                  </select>

                  <div className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute end-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pe-8"
                      placeholder="جست‌وجو بر اساس شماره مالیاتی، فاکتور یا طرف حساب…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {filteredRows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    ردیفی مطابق فیلتر انتخاب‌شده یافت نشد.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>بخش</TableHead>
                          <TableHead>وضعیت تطبیق</TableHead>
                          <TableHead>مبنای تطبیق</TableHead>
                          <TableHead>شماره مالیاتی</TableHead>
                          <TableHead>شماره صورتحساب</TableHead>
                          <TableHead>طرف حساب</TableHead>
                          <TableHead>مالیات سیستم ما</TableHead>
                          <TableHead>مالیات کارپوشه</TableHead>
                          <TableHead>مبلغ کل سیستم ما</TableHead>
                          <TableHead>مبلغ کل کارپوشه</TableHead>
                          <TableHead>اختلاف کل</TableHead>
                          <TableHead>توضیحات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>{SECTION_LABELS[row.section]}</TableCell>
                            <TableCell>
                              <Badge variant={bucketBadgeVariant(row.bucket)}>
                                {BUCKET_LABELS[row.bucket]}
                              </Badge>
                            </TableCell>
                            <TableCell>{MATCH_BY_LABELS[row.matchBy]}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {row.taxId ?? "—"}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {row.invoiceNumber ?? "—"}
                            </TableCell>
                            <TableCell>{row.counterpartyName ?? "—"}</TableCell>
                            <TableCell>{formatMoneyRial(row.ourVatAmount)}</TableCell>
                            <TableCell>{formatMoneyRial(row.kartableVatAmount)}</TableCell>
                            <TableCell>{formatMoneyRial(row.ourTotalAmount)}</TableCell>
                            <TableCell>{formatMoneyRial(row.kartableTotalAmount)}</TableCell>
                            <TableCell
                              className={
                                isNonZeroAmount(row.totalDiff)
                                  ? "font-semibold text-destructive"
                                  : undefined
                              }
                            >
                              {formatMoneyRial(row.totalDiff)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {row.note ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </EnterpriseRouteGuard>
  );
}
