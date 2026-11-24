"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, TrendingUp } from "lucide-react";

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
import { getGrossProfitReport } from "@/lib/api/invoicing-client";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import type { GrossProfitReportResponse } from "@/types/invoicing";

type GroupBy = "invoice" | "item" | "customer";

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  invoice: "به تفکیک فاکتور",
  item: "به تفکیک کالا",
  customer: "به تفکیک مشتری",
};

export default function GrossProfitReportPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>("item");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<GrossProfitReportResponse | null>(null);

  async function fetchReport(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await getGrossProfitReport({
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
    const params = new URLSearchParams({ groupBy });
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    params.set("format", format);
    return `${API_PROXY_BASE_PATH}/${INVOICING_RESOURCE_PATH}/reports/gross-profit?${params.toString()}`;
  }

  // Calculate totals strictly from API response groups
  const totalRevenue = report?.groups.reduce((acc, g) => acc + BigInt(g.revenue), 0n) ?? 0n;
  const totalCogs = report?.groups.reduce((acc, g) => acc + BigInt(g.cogs), 0n) ?? 0n;
  const totalProfit = report?.groups.reduce((acc, g) => acc + BigInt(g.profit), 0n) ?? 0n;

  return (
    <EnterpriseRouteGuard>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="گزارش سود ناخالص"
          description="تحلیل درآمد، بهای تمام‌شده کالای فروش‌رفته (COGS)، سود ناخالص و درصد حاشیه سود بر مبنای ارقام محاسباتی سرور"
          icon={<TrendingUp className="h-6 w-6 text-primary" />}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={getExportUrl("xlsx")} target="_blank" rel="noopener noreferrer">
                  <FileSpreadsheet className="ml-1.5 h-4 w-4" /> خروجی اکسل
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={getExportUrl("pdf")} target="_blank" rel="noopener noreferrer">
                  <FileText className="ml-1.5 h-4 w-4" /> خروجی PDF
                </a>
              </Button>
            </div>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">فیلترهای گزارش سود ناخالص</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={fetchReport} className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4 items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gp-group-by">مبنای گروه‌بندی</Label>
                <select
                  id="gp-group-by"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                >
                  <option value="item">به تفکیک کالا</option>
                  <option value="customer">به تفکیک مشتری</option>
                  <option value="invoice">به تفکیک فاکتور</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gp-from-date">از تاریخ (میلادی)</Label>
                <Input
                  id="gp-from-date"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gp-to-date">تا تاریخ (میلادی)</Label>
                <Input
                  id="gp-to-date"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>

              <div>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Download className="ml-2 h-4 w-4" />}
                  به‌روزرسانی گزارش
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <LoadingLine show={loading} />
        <ErrorNotice title="خطا در دریافت گزارش سود ناخالص" message={error} />

        {report && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">درآمد کل فروش</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">{formatMoneyRial(totalRevenue.toString())}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">بهای تمام‌شده کل (COGS)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">{formatMoneyRial(totalCogs.toString())}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">سود ناخالص کل</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-primary">{formatMoneyRial(totalProfit.toString())}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  جدول اقلام سود ناخالص ({GROUP_BY_LABELS[report.groupBy]})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {report.groups.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    هیچ داده‌ای در بازه زمانی و گروه‌بندی انتخابی یافت نشد.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">ردیف</TableHead>
                        <TableHead>عنوان ({report.groupBy === "item" ? "کالا" : report.groupBy === "customer" ? "مشتری" : "فاکتور"})</TableHead>
                        <TableHead className="text-left">درآمد (ریال)</TableHead>
                        <TableHead className="text-left">بهای تمام‌شده (ریال)</TableHead>
                        <TableHead className="text-left">سود ناخالص (ریال)</TableHead>
                        <TableHead className="text-center w-28">حاشیه سود</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.groups.map((group, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{formatNumber(idx + 1)}</TableCell>
                          <TableCell className="font-medium">{group.key}</TableCell>
                          <TableCell className="text-left font-mono">{formatMoneyRial(group.revenue)}</TableCell>
                          <TableCell className="text-left font-mono">{formatMoneyRial(group.cogs)}</TableCell>
                          <TableCell className="text-left font-mono font-bold text-primary">
                            {formatMoneyRial(group.profit)}
                          </TableCell>
                          <TableCell className="text-center font-mono text-xs">{group.margin}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </EnterpriseRouteGuard>
  );
}
