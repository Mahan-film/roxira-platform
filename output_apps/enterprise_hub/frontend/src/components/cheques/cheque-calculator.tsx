"use client";

import { useEffect, useRef, useState } from "react";
import { Calculator, Calendar, CheckSquare, Coins, Percent, Plus, RefreshCw, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  calculateDiscountApi,
  calculateSelectionDiscountApi,
  listCheques,
} from "@/lib/api/cheques-client";
import {
  areCalculatorResultsEqual,
  calculateClientRasgiriAndDiscount,
  ClientChequeItem,
  ClientRasgiriDiscountResult,
  diffDays,
  effectiveChequeAmount,
  formatJalaliFromYmd,
  isCalculatorEligibleCheque,
  parseRateScaled,
  tehranTodayIso,
} from "@/lib/cheque-calculator";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { STATUS_LABELS, type Cheque, type ChequeDirection } from "@/types/cheques";

interface ChequeCalculatorProps {
  direction?: ChequeDirection;
}

export function ChequeCalculator({ direction: initialDirection = "received" }: ChequeCalculatorProps) {
  const [direction, setDirection] = useState<ChequeDirection>(initialDirection);
  const [mode, setMode] = useState<"existing" | "manual">("existing");
  const [baseDate, setBaseDate] = useState<string>(() => tehranTodayIso());
  const [annualRateInput, setAnnualRateInput] = useState<string>("");

  // Existing cheques state
  const [existingCheques, setExistingCheques] = useState<Cheque[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loadedDirection, setLoadedDirection] = useState<ChequeDirection | null>(null);
  const loading = mode === "existing" && loadedDirection !== direction;

  // Manual cheques state
  const nextManualId = useRef(3);
  const [manualRows, setManualRows] = useState<
    Array<{ id: string; amount: string; dueDate: string; description: string }>
  >(() => {
    const today = tehranTodayIso();
    return [
      { id: "1", amount: "500000000", dueDate: today, description: "چک نمونه ۱" },
      { id: "2", amount: "1000000000", dueDate: today, description: "چک نمونه ۲" },
    ];
  });

  // Optional server verification state
  const [serverVerifying, setServerVerifying] = useState(false);
  const [serverVerifyMessage, setServerVerifyMessage] = useState<string | null>(null);

  // Load existing cheques; auto-select only open cheques with positive remaining balance
  useEffect(() => {
    if (mode !== "existing") return;
    let cancelled = false;
    listCheques({ direction })
      .then((data) => {
        if (cancelled) return;
        setExistingCheques(data);
        setSelectedIds(new Set(data.filter(isCalculatorEligibleCheque).map((c) => c.id)));
        setServerVerifyMessage(null);
        setLoadedDirection(direction);
      })
      .catch(() => {
        if (cancelled) return;
        setExistingCheques([]);
        setSelectedIds(new Set());
        setLoadedDirection(direction);
      });
    return () => {
      cancelled = true;
    };
  }, [direction, mode]);

  const eligibleCheques = existingCheques.filter(isCalculatorEligibleCheque);

  const toggleSelect = (cheque: Cheque) => {
    if (!isCalculatorEligibleCheque(cheque)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cheque.id)) next.delete(cheque.id);
      else next.add(cheque.id);
      return next;
    });
  };

  const selectAllEligible = () => {
    if (eligibleCheques.length === 0) return;
    if (selectedIds.size === eligibleCheques.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(eligibleCheques.map((c) => c.id)));
    }
  };

  const rateEmpty = annualRateInput.trim() === "";
  const rateValid = parseRateScaled(annualRateInput) !== null;
  const calculationItems: ClientChequeItem[] =
    mode === "existing"
      ? existingCheques
          .filter((c) => isCalculatorEligibleCheque(c) && selectedIds.has(c.id))
          .map((c) => ({
            id: c.id,
            amount: effectiveChequeAmount(c),
            dueDate: c.dueDate,
            sayadNumber: c.sayadNumber ?? undefined,
            description: c.partyName || c.description || undefined,
          }))
      : manualRows.map((r) => ({
          id: r.id,
          amount: r.amount,
          dueDate: r.dueDate,
          description: r.description,
        }));

  const result: ClientRasgiriDiscountResult = calculateClientRasgiriAndDiscount(
    calculationItems,
    rateValid ? annualRateInput : "0",
    baseDate,
  );

  const invalidIds = new Set(result.invalidItems.map((i) => String(i.id)));

  const addManualRow = () => {
    const nextId = String(nextManualId.current++);
    setManualRows((prev) => [
      ...prev,
      { id: nextId, amount: "", dueDate: tehranTodayIso(), description: "" },
    ]);
  };

  const removeManualRow = (id: string) => {
    setManualRows((prev) => prev.filter((r) => r.id !== id));
  };

  const updateManualRow = (id: string, field: "amount" | "dueDate" | "description", val: string) => {
    setManualRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  };

  const verifyWithServer = async () => {
    if (!rateValid || result.totalCount === 0) return;
    setServerVerifying(true);
    setServerVerifyMessage(null);
    try {
      const rateNumber = result.annualRatePercent;
      const serverRes =
        mode === "existing"
          ? await calculateSelectionDiscountApi({
              chequeIds: Array.from(selectedIds),
              annualRatePercent: rateNumber,
              baseDate: baseDate || undefined,
            })
          : await calculateDiscountApi({
              items: result.items.map((item) => ({
                id: item.id,
                amount: item.amountDecimal,
                dueDate: item.dueDate,
                sayadNumber: item.sayadNumber,
                description: item.description,
              })),
              annualRatePercent: rateNumber,
              baseDate: baseDate || undefined,
            });
      if (areCalculatorResultsEqual(result, serverRes)) {
        setServerVerifyMessage(
          `محاسبه سرور با مرورگر تطابق دارد: راس ${formatNumber(serverRes.weightedAverageDays)} روز، کارمزد ${formatMoneyRial(serverRes.totalDiscountAmount)}`,
        );
      } else {
        setServerVerifyMessage(
          `عدم تطابق با سرور: مرورگر (جمع ${result.totalAmountFormatted}، راس ${formatNumber(result.weightedAverageDays)} روز، کارمزد ${result.totalDiscountFormatted}) ≠ سرور (جمع ${formatMoneyRial(serverRes.totalAmount)}، راس ${formatNumber(serverRes.weightedAverageDays)} روز، کارمزد ${formatMoneyRial(serverRes.totalDiscountAmount)})`,
        );
      }
    } catch (err) {
      setServerVerifyMessage(err instanceof Error ? err.message : "خطا در دریافت محاسبه از سرور");
    } finally {
      setServerVerifying(false);
    }
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
              <label className="text-xs font-medium text-muted-foreground">تاریخ مبنا (به وقت تهران)</label>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  type="date"
                  value={baseDate}
                  onChange={(e) => setBaseDate(e.target.value)}
                  className="text-sm"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setBaseDate(tehranTodayIso())}
                  title="امروز (تهران)"
                >
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
                  max="100"
                  step="0.5"
                  placeholder="مثلاً ۲۴"
                  value={annualRateInput}
                  onChange={(e) => setAnnualRateInput(e.target.value)}
                  className="text-sm"
                  dir="ltr"
                />
                <Percent className="size-4 text-muted-foreground" />
              </div>
              {!rateValid ? (
                <p className="mt-1 text-xs text-red-600">نرخ تنزیل باید بین ۰ تا ۱۰۰ درصد باشد.</p>
              ) : rateEmpty ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  در صورت خالی بودن نرخ، نرخ ۰٪ و کارمزد تنزیل صفر در نظر گرفته می‌شود (مبنای ۳۶۵ روز).
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  مبنای محاسبه ۳۶۵ روز؛ برای چک‌های سررسیدگذشته روز منفی در راس‌گیری لحاظ می‌شود و کارمزد تنزیل صفر است.
                </p>
              )}
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
              {result.totalAmountFormatted}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{result.totalTomanFormatted}</p>
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
              <span className="text-xs font-medium text-muted-foreground">کارمزد تنزیل ({formatNumber(result.annualRatePercent)}٪)</span>
              <Percent className="size-4 text-amber-500" />
            </div>
            <p className="mt-2 text-xl font-bold tracking-tight text-amber-900 dark:text-amber-200">
              {result.totalDiscountFormatted}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{result.totalDiscountTomanFormatted}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50/50 to-blue-100/30 dark:from-blue-950/20 dark:to-blue-900/10 border-blue-200/50">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {mode === "existing" && direction === "issued"
                  ? "خالص تعهد پس از تنزیل"
                  : "خالص دریافتی پس از تنزیل"}
              </span>
              <Calculator className="size-4 text-blue-500" />
            </div>
            <p className="mt-2 text-xl font-bold tracking-tight text-blue-900 dark:text-blue-200">
              {result.netPresentValueFormatted}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{result.netPresentValueTomanFormatted}</p>
          </CardContent>
        </Card>
      </div>

      {/* Server verification bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={serverVerifying || !rateValid || result.totalCount === 0}
          onClick={verifyWithServer}
        >
          {serverVerifying ? "در حال بررسی با سرور..." : "تأیید محاسبه از سرور"}
        </Button>
        {serverVerifyMessage && (
          <span className="text-xs text-muted-foreground">{serverVerifyMessage}</span>
        )}
      </div>

      {/* Cheques Selection / Input Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              {mode === "existing" ? "فهرست چک‌ها (فقط چک‌های باز و دارای مانده قابل انتخاب‌اند)" : "ردیف‌های چک دستی"}
            </CardTitle>
            {mode === "existing" ? (
              <Button size="sm" variant="ghost" onClick={selectAllEligible} className="text-xs">
                {eligibleCheques.length > 0 && selectedIds.size === eligibleCheques.length ? (
                  <>
                    <Square className="size-4 ml-1" /> عدم انتخاب همه
                  </>
                ) : (
                  <>
                    <CheckSquare className="size-4 ml-1" /> انتخاب همه چک‌های باز ({eligibleCheques.length})
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
                    <TableHead>وضعیت</TableHead>
                    <TableHead>شناسه صیاد</TableHead>
                    <TableHead className="text-left">مانده قابل محاسبه</TableHead>
                    <TableHead>سررسید</TableHead>
                    <TableHead className="text-center">فاصله (روز)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {existingCheques.map((c) => {
                    const eligible = isCalculatorEligibleCheque(c);
                    const isSelected = eligible && selectedIds.has(c.id);
                    const days = diffDays(baseDate, c.dueDate);
                    const displayAmount = formatMoneyRial(effectiveChequeAmount(c));
                    return (
                      <TableRow
                        key={c.id}
                        className={
                          eligible
                            ? `cursor-pointer ${isSelected ? "bg-muted/40 font-medium" : "opacity-60"}`
                            : "opacity-40 cursor-not-allowed"
                        }
                        onClick={() => toggleSelect(c)}
                      >
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            disabled={!eligible}
                            checked={isSelected}
                            onChange={() => toggleSelect(c)}
                            className="rounded border-gray-300"
                          />
                        </TableCell>
                        <TableCell>{c.partyName || c.description || "-"}</TableCell>
                        <TableCell className="text-xs">{STATUS_LABELS[c.direction][c.status]}</TableCell>
                        <TableCell className="font-mono text-xs" dir="ltr">
                          {c.sayadNumber || "-"}
                        </TableCell>
                        <TableCell className="text-left font-mono" dir="ltr">
                          {displayAmount}
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
              {result.invalidItems.length > 0 && (
                <p className="mb-3 text-xs text-red-600">
                  {formatNumber(result.invalidItems.length)} ردیف دارای مبلغ یا تاریخ نامعتبر است و در محاسبه لحاظ نشد.
                </p>
              )}
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
                  {manualRows.map((row, idx) => {
                    const isInvalid = invalidIds.has(row.id);
                    return (
                      <TableRow key={row.id} className={isInvalid ? "bg-red-50/50 dark:bg-red-950/10" : ""}>
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
                    );
                  })}
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
                  <TableHead className="text-left">مبلغ اسمی</TableHead>
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
