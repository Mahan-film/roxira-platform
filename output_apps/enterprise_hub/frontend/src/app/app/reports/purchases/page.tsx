"use client";

import { useEffect, useState } from "react";
import { FileSpreadsheet, FileText, Loader2, ShoppingCart } from "lucide-react";

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
import { API_PROXY_BASE_PATH, INVOICING_RESOURCE_PATH } from "@/lib/api/config";
import {
  getPurchasesReport,
  type PurchasesReportResponse,
} from "@/lib/api/invoicing-client";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";

type GroupBy = "item" | "supplier" | "invoice";

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  item: "به تفکیک کالا",
  supplier: "به تفکیک تأمین‌کننده",
  invoice: "به تفکیک فاکتور",
};

export default function PurchasesReportPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>("item");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PurchasesReportResponse | null>(null);

  async function fetchReport(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await getPurchasesReport({
        groupBy,
        from: fromDate.trim() || undefined,
        to: toDate.trim() || undefined,
      });
      setReport(data);
    } catch (err) {
      setError(loadErrorMessage(err));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy]);

  function getExportUrl(format: "xlsx" | "pdf") {
    const params = new URLSearchParams({ groupBy, format });
    if (fromDate.trim()) params.set("from", fromDate.trim());
    if (toDate.trim()) params.set("to", toDate.trim());
    return `${API_PROXY_BASE_PATH}/${INVOICING_RESOURCE_PATH}/reports/purchases?${params.toString()}`;
  }

  return (
    <EnterpriseRouteGuard>
      <div className="space-y-6">
        <PageHeader
          title="گزارش خرید"
          description="تحلیل خرید به تفکیک کالا، تأمین‌کننده یا فاکتور با خروجی Excel و PDF"
          icon={ShoppingCart}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">فیلترها</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={fetchReport} className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="groupBy">گروه‌بندی</Label>
                <select
                  id="groupBy"
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
                >
                  {Object.entries(GROUP_BY_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fromDate">از تاریخ</Label>
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
              <div className="flex items-end gap-2">
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="me-2 size-4 animate-spin" />}
                  اعمال
                </Button>
                <Button type="button" variant="outline" asChild>
                  <a href={getExportUrl("xlsx")} download>
                    <FileSpreadsheet className="me-1.5 size-4" />
                    Excel
                  </a>
                </Button>
                <Button type="button" variant="outline" asChild>
                  <a href={getExportUrl("pdf")} download>
                    <FileText className="me-1.5 size-4" />
                    PDF
                  </a>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {error && <ErrorNotice message={error} />}
        {loading && <LoadingLine label="در حال دریافت گزارش خرید..." />}

        {report && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">خالص خرید</CardTitle>
                </CardHeader>
                <CardContent className="text-lg font-semibold">
                  {formatMoneyRial(report.totalNet)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">مالیات بر ارزش افزوده</CardTitle>
                </CardHeader>
                <CardContent className="text-lg font-semibold">
                  {formatMoneyRial(report.totalVat)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">جمع کل خرید</CardTitle>
                </CardHeader>
                <CardContent className="text-lg font-semibold">
                  {formatMoneyRial(report.totalAmount)}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="overflow-x-auto pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>عنوان</TableHead>
                      <TableHead>تعداد</TableHead>
                      <TableHead>خالص</TableHead>
                      <TableHead>مالیات</TableHead>
                      <TableHead>جمع کل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          داده‌ای برای نمایش وجود ندارد.
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.rows.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell>{row.label}</TableCell>
                          <TableCell>
                            {row.quantity !== undefined ? formatNumber(Number(row.quantity)) : "—"}
                          </TableCell>
                          <TableCell>{formatMoneyRial(row.netAmount)}</TableCell>
                          <TableCell>{formatMoneyRial(row.vatAmount)}</TableCell>
                          <TableCell className="font-medium">
                            {formatMoneyRial(row.totalAmount)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </EnterpriseRouteGuard>
  );
}
