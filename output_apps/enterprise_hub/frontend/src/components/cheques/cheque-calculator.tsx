"use client";

import { useEffect, useState } from "react";
import { Calculator, Calendar, CheckSquare, Coins, Percent, Plus, RefreshCw, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCheques } from "@/lib/api/cheques-client";
import {
  calculateClientRasgiriAndDiscount,
  ClientChequeItem,
  ClientRasgiriDiscountResult,
  diffDays,
  formatJalaliFromYmd,
  formatRials,
  formatTomans,
} from "@/lib/cheque-calculator";
import { formatNumber } from "@/lib/fa-format";
import type { Cheque, ChequeDirection } from "@/types/cheques";

interface ChequeCalculatorProps {
  direction?: ChequeDirection;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function ChequeCalculator({ direction: initialDirection = "received" }: ChequeCalculatorProps) {
  const [direction, setDirection] = useState<ChequeDirection>(initialDirection);
  const [mode, setMode] = useState<"existing" | "manual">("existing");
  const [baseDate, setBaseDate] = useState<string>(todayIso());
  const [annualRate, setAnnualRate] = useState<number>(24);

  // Existing cheques state
  const [existingCheques, setExistingCheques] = useState<Cheque[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  // Manual cheques state
  const [manualRows, setManualRows] = useState<Array<{ id: string; amount: string; dueDate: string; description: string }>>([
    { id: "1", amount: "500000000", dueDate: todayIso(), description: "چک نمونه ۱" },
    { id: "2", amount: "1000000000", dueDate: todayIso(), description: "چک نمونه ۲" },
  ]);

  // Load existing cheques
  useEffect(() => {
    if (mode === "existing") {
      setLoading(true);
      listCheques({ direction })
        .then((data) => {
          setExistingCheques(data);
          // By default, select all open cheques
          setSelectedIds(new Set(data.map((c) => c.id)));
        })
        .catch(() => {
          setExistingCheques([]);
          setSelectedIds(new Set());
        })
        .finally(() => setLoading(false));
    }
  }, [direction, mode]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === existingCheques.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(existingCheques.map((c) => c.id)));
    }
  };

  // Build items list based on mode
  const calculationItems: ClientChequeItem[] =
    mode === "existing"
      ? existingCheques
          .filter((c) => selectedIds.has(c.id))
          .map((c) => ({
            id: c.id,
            amount: c.remainingAmount || c.amount,
            dueDate: c.dueDate,
            sayadNumber: c.sayadNumber,
            description: c.partyName || c.description,
          }))
      : manualRows.map((r) => ({
          id: r.id,
          amount: r.amount,
          dueDate: r.dueDate,
          description: r.description,
        }));

  const result: ClientRasgiriDiscountResult = calculateClientRasgiriAndDiscount(
    calculationItems,
    annualRate,
    baseDate,
  );

  const addManualRow = () => {
    const nextId = String(Date.now());
    setManualRows((prev) => [...prev, { id: nextId, amount: "", dueDate: todayIso(), description: "" }]);
  };

  const removeManualRow = (id: string) => {
    setManualRows((prev) => prev.filter((r) => r.id !== id));
  };

  const updateManualRow = (id: string, field: "amount" | "dueDate" | "description", val: string) => {
    setManualRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Configuration & Controls */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Calculator className="size-5 text-indigo-600" />
              ماشین حساب راس‌گیری و تنزیل چک
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={mode === "existing" ? "default" : "outline"}
                onClick={() => setMode("existing")}
              >
                انتخاب از چک‌های ثبت‌شده
              </Button>
              <Button
                size="sm"
                variant={mode === "manual" ? "default" : "outline"}
                onClick={() => setMode("manual")}
              >
                ورود دستی مبالغ و سررسیدها
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">تاریخ مبنا (محاسبه روزها)</label>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  type="date"
                  value={baseDate}
                  onChange={(e) => setBaseDate(e.target.value)}
                  className="text-sm"
                />
                <Button size="sm" variant="ghost" onClick={() => setBaseDate(todayIso())} title="امروز">
                  <RefreshCw className="size-4" />
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                شمسی: {formatJalaliFromYmd(baseDate)}
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">نرخ سالانه تنزیل (درصد)</label>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={annualRate}
                  onChange={(e) => setAnnualRate(Number(e.target.value) || 0)}
                  className="text-sm"
                  dir="ltr"
                />
                <Percent className="size-4 text-muted-foreground" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                مبنای ۳۶۵ روز در سال بر اساس ضوابط بازار پول
              </p>
            </div>

            {mode === "existing" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">نوع چک‌ها</label>
                <div className="mt-1 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={direction === "received" ? "default" : "outline"}
                    onClick={() => setDirection("received")}
                  >
                    دریافتی
                  </Button>
                  <Button
                    size="sm"
                    variant={direction === "issued" ? "default" : "outline"}
                    onClick={() => setDirection("issued")}
                  >
                    پرداختنی
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-gradient-to-br from-indigo-50/50 to-indigo-100/30 dark:from-indigo-950/20 dark:to-indigo-900/10 border-indigo-200/50">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">مجموع مبالغ ({formatNumber(result.totalCount)} فقره)</span>
              <Coins className="size-4 text-indigo-500" />
            </div>
            <p className="mt-2 text-xl font-bold tracking-tight text-indigo-900 dark:text-indigo-200">
              {formatRials(result.totalAmount)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{formatTomans(result.totalAmount)}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-50/50 to-emerald-100/30 dark:from-emerald-950/20 dark:to-emerald-900/10 border-emerald-200/50">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">راس سررسید (روز میانگین)</span>
              <Calendar className="size-4 text-emerald-500" />
            </div>
            <p className="mt-2 text-xl font-bold tracking-tight text-emerald-900 dark:text-emerald-200">
              {formatNumber(result.weightedAverageDays)} روز
            </p>
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              تاریخ راس: {result.weightedMaturityJalali}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50/50 to-amber-100/30 dark:from-amber-950/20 dark:to-amber-900/10 border-amber-200/50">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">کارمزد تنزیل ({formatNumber(annualRate)}٪)</span>
              <Percent className="size-4 text-amber-500" />
            </div>
            <p className="mt-2 text-xl font-bold tracking-tight text-amber-900 dark:text-amber-200">
              {formatRials(result.totalDiscountAmount)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{formatTomans(result.totalDiscountAmount)}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50/50 to-blue-100/30 dark:from-blue-950/20 dark:to-blue-900/10 border-blue-200/50">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">خالص دریافتی پس از تنزیل</span>
              <Calculator className="size-4 text-blue-500" />
            </div>
            <p className="mt-2 text-xl font-bold tracking-tight text-blue-900 dark:text-blue-200">
              {formatRials(result.netPresentValue)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{formatTomans(result.netPresentValue)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Cheques Selection / Input Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              {mode === "existing" ? "فهرست چک‌ها برای محاسبه" : "ردیف‌های چک دستی"}
            </CardTitle>
            {mode === "existing" ? (
              <Button size="sm" variant="ghost" onClick={selectAll} className="text-xs">
                {selectedIds.size === existingCheques.length ? (
                  <>
                    <Square className="size-4 ml-1" /> عدم انتخاب همه
                  </>
                ) : (
                  <>
                    <CheckSquare className="size-4 ml-1" /> انتخاب همه ({existingCheques.length})
                  </>
                )}
              </Button>
            ) : (
              <Button size="sm" onClick={addManualRow} className="text-xs">
                <Plus className="size-4 ml-1" /> افزودن چک
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {mode === "existing" ? (
            loading ? (
              <p className="p-6 text-center text-sm text-muted-foreground">در حال بارگذاری چک‌ها...</p>
            ) : existingCheques.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">چکی در این دسته یافت نشد.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center">انتخاب</TableHead>
                    <TableHead>طرف حساب / شرح</TableHead>
                    <TableHead>شناسه صیاد</TableHead>
                    <TableHead className="text-left">مبلغ (ریال)</TableHead>
                    <TableHead>سررسید</TableHead>
                    <TableHead className="text-center">فاصله (روز)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {existingCheques.map((c) => {
                    const isSelected = selectedIds.has(c.id);
                    const days = diffDays(baseDate, c.dueDate);
                    return (
                      <TableRow
                        key={c.id}
                        className={`cursor-pointer ${isSelected ? "bg-muted/40 font-medium" : "opacity-60"}`}
                        onClick={() => toggleSelect(c.id)}
                      >
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(c.id)}
                            className="rounded border-gray-300"
                          />
                        </TableCell>
                        <TableCell>{c.partyName || c.description || "-"}</TableCell>
                        <TableCell className="font-mono text-xs" dir="ltr">
                          {c.sayadNumber || "-"}
                        </TableCell>
                        <TableCell className="text-left font-mono" dir="ltr">
                          {Number(c.remainingAmount || c.amount).toLocaleString("fa-IR")}
                        </TableCell>
                        <TableCell>
                          {formatJalaliFromYmd(c.dueDate)}
                          <span className="block text-[10px] text-muted-foreground">{c.dueDate}</span>
                        </TableCell>
                        <TableCell className="text-center font-mono">
                          {days >= 0 ? `${formatNumber(days)} روز` : `${formatNumber(-days)} روز معوق`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )
          ) : (
            <div className="p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>مبلغ (ریال)</TableHead>
                    <TableHead>تاریخ سررسید (میلادی / تقویم)</TableHead>
                    <TableHead>سررسید شمسی</TableHead>
                    <TableHead>شرح چک</TableHead>
                    <TableHead className="w-16 text-center">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {manualRows.map((row, idx) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{idx + 1}</TableCell>
                      <TableCell>
                        <Input
                          placeholder="مبلغ به ریال"
                          value={row.amount}
                          onChange={(e) => updateManualRow(row.id, "amount", e.target.value)}
                          dir="ltr"
                          className="font-mono text-sm"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          value={row.dueDate}
                          onChange={(e) => updateManualRow(row.id, "dueDate", e.target.value)}
                          className="text-sm"
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatJalaliFromYmd(row.dueDate)}
                      </TableCell>
                      <TableCell>
                        <Input
                          placeholder="طرف حساب یا بابت"
                          value={row.description}
                          onChange={(e) => updateManualRow(row.id, "description", e.target.value)}
                          className="text-sm"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeManualRow(row.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detailed Calculation Results Table */}
      {result.items.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              ریز محاسبات راس‌گیری و تنزیل به ازای هر فقره چک
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>شرح / چک</TableHead>
                  <TableHead className="text-left">مبلغ اسمی (ریال)</TableHead>
                  <TableHead>سررسید</TableHead>
                  <TableHead className="text-center">فاصله تا مبنا</TableHead>
                  <TableHead className="text-center">سهم وزنی</TableHead>
                  <TableHead className="text-left">کارمزد تنزیل</TableHead>
                  <TableHead className="text-left">خالص دریافتی</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((item, index) => (
                  <TableRow key={item.id ?? index}>
                    <TableCell className="text-center font-mono text-xs">{index + 1}</TableCell>
                    <TableCell>
                      <span className="font-medium">{item.description || "چک"}</span>
                      {item.sayadNumber && (
                        <span className="block font-mono text-[10px] text-muted-foreground" dir="ltr">
                          {item.sayadNumber}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-left font-mono" dir="ltr">
                      {item.amountFormatted}
                    </TableCell>
                    <TableCell>
                      <span>{item.dueDateJalali}</span>
                      <span className="block text-[10px] text-muted-foreground">{item.dueDate}</span>
                    </TableCell>
                    <TableCell className="text-center font-mono">
                      {item.days >= 0 ? `${formatNumber(item.days)} روز` : `${formatNumber(-item.days)} روز قبل`}
                    </TableCell>
                    <TableCell className="text-center font-mono font-medium">
                      {formatNumber(item.weightPercent)}٪
                    </TableCell>
                    <TableCell className="text-left font-mono text-amber-600 dark:text-amber-400" dir="ltr">
                      {item.discountFormatted}
                    </TableCell>
                    <TableCell className="text-left font-mono font-semibold text-emerald-600 dark:text-emerald-400" dir="ltr">
                      {item.netPresentValueFormatted}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
