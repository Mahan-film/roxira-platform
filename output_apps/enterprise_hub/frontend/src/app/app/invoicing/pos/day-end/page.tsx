"use client";

import { useCallback, useEffect, useState } from "react";
import { Calculator, Loader2, RefreshCw } from "lucide-react";

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
import { listInvoices } from "@/lib/api/invoicing-client";
import { formatMoneyRial } from "@/lib/fa-format";
import { computeCashDiff, summarizePosDayEnd, type PosDayEndSummary } from "@/lib/pos-day-end";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PosDayEndPage() {
  const [targetDate, setTargetDate] = useState<string>(todayIso);
  const [countedCashInput, setCountedCashInput] = useState<string>("0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PosDayEndSummary | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const invoices = await listInvoices();
      setSummary(summarizePosDayEnd(invoices, targetDate));
    } catch (err) {
      setError(loadErrorMessage(err));
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [targetDate]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  let countedCash = 0n;
  let countedValid = true;
  try {
    const trimmed = countedCashInput.trim();
    countedCash = trimmed === "" ? 0n : BigInt(trimmed);
  } catch {
    countedValid = false;
  }

  const cashDiff = summary && countedValid ? computeCashDiff(summary.cashTotal, countedCash) : 0n;

  return (
    <EnterpriseRouteGuard>
      <div className="space-y-6">
        <PageHeader
          title="بستن پایان روز صندوق و گزارش فروش روزانه"
          description="جمع فروش روزانه به تفکیک نقد، کارت‌خوان و انتقال بانکی و تطبیق موجودی نقدی صندوق"
          icon={Calculator}
        />

        <Card>
          <CardContent className="flex flex-wrap items-end gap-4 pt-6">
            <div className="space-y-1.5">
              <Label htmlFor="targetDate">تاریخ گزارش</Label>
              <Input
                id="targetDate"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
            <Button type="button" onClick={loadSummary} disabled={loading}>
              {loading ? (
                <Loader2 className="me-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="me-2 size-4" />
              )}
              به‌روزرسانی
            </Button>
          </CardContent>
        </Card>

        {error && <ErrorNotice message={error} />}
        {loading && <LoadingLine label="در حال محاسبه گزارش پایان روز..." />}

        {summary && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">فروش نقدی</CardTitle>
                </CardHeader>
                <CardContent className="text-lg font-semibold">
                  {formatMoneyRial(summary.cashTotal)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">فروش کارت‌خوان</CardTitle>
                </CardHeader>
                <CardContent className="text-lg font-semibold">
                  {formatMoneyRial(summary.cardTotal)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">انتقال بانکی</CardTitle>
                </CardHeader>
                <CardContent className="text-lg font-semibold">
                  {formatMoneyRial(summary.transferTotal)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">
                    جمع کل فروش ({summary.invoiceCount} فاکتور)
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-lg font-semibold">
                  {formatMoneyRial(summary.grandTotal)}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">تطبیق صندوق نقدی</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">نقد مورد انتظار سیستم</div>
                  <div className="text-base font-semibold">{formatMoneyRial(summary.cashTotal)}</div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="countedCash">مبلغ شمارش‌شده نقد (ریال)</Label>
                  <Input
                    id="countedCash"
                    inputMode="numeric"
                    value={countedCashInput}
                    onChange={(e) => setCountedCashInput(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">اختلاف صندوق (شمارش‌شده − انتظار)</div>
                  <div
                    className={`text-base font-semibold ${
                      !countedValid
                        ? "text-destructive"
                        : cashDiff === 0n
                          ? "text-foreground"
                          : "text-destructive"
                    }`}
                  >
                    {countedValid ? formatMoneyRial(cashDiff) : "عدد نامعتبر"}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">فهرست فاکتورهای روز</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>شماره</TableHead>
                      <TableHead>تاریخ</TableHead>
                      <TableHead>مبلغ کل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.invoices.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          فاکتوری برای این تاریخ ثبت نشده است.
                        </TableCell>
                      </TableRow>
                    ) : (
                      summary.invoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell>{inv.invoiceNumber || `#${inv.id}`}</TableCell>
                          <TableCell>{inv.issueDate}</TableCell>
                          <TableCell>{formatMoneyRial(inv.totalAmount)}</TableCell>
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
