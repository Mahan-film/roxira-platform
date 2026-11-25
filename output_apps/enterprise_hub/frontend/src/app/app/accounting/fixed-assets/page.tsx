"use client";

import { useEffect, useState } from "react";
import { Building2, CalendarClock, Download, FileSpreadsheet } from "lucide-react";

import { ErrorNotice, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CASH_ACCOUNT_ROLES,
  createFixedAsset,
  disposeFixedAsset,
  downloadFixedAssetRegister,
  downloadFixedAssetSchedule,
  getFixedAssetRegister,
  getFixedAssetSchedule,
  listFixedAssets,
  runMonthlyDepreciation,
  type CashAccountRole,
  type DepreciationRunResult,
  type DepreciationScheduleResult,
  type FixedAsset,
  type FixedAssetDisposalResult,
  type FixedAssetMethod,
  type FixedAssetRegisterResult,
} from "@/lib/api/fixed-assets-client";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import {
  FIXED_ASSET_METHOD_LABELS,
  FIXED_ASSET_STATUS_LABELS,
  JALALI_MONTH_NAMES,
  SKIPPED_REASON_LABELS,
  formatDepreciationRunSummary,
  isValidJalaliPeriod,
} from "@/lib/fixed-assets-ui";

/** گزینهٔ «حساب دیگر» در انتخاب محل تسویه؛ کد حساب دستی گرفته می‌شود. */
const SETTLEMENT_CUSTOM = "custom";
const SETTLEMENT_EMPTY = "";

const today = () => new Date().toISOString().slice(0, 10);
const CODE_RE = /^[A-Za-z0-9._-]{1,32}$/;
const ACCOUNT_RE = /^[A-Za-z0-9._-]{1,32}$/;
const MONEY_RE = /^\d{1,16}(\.\d{1,2})?$/;
const ANNUAL_RATE_RE = /^(0(\.\d{1,6})?|1(\.0{1,6})?)$/;

interface RegisterDraft {
  code: string;
  name: string;
  category: string;
  acquisitionDate: string;
  cost: string;
  salvageValue: string;
  method: FixedAssetMethod;
  lifeMonths: string;
  annualRate: string;
  assetAccountCode: string;
  accumulatedAccountCode: string;
  expenseAccountCode: string;
}

interface DisposeDraft {
  date: string;
  proceeds: string;
  role: string;
  settlementAccountCode: string;
  note: string;
}

const emptyRegister = (): RegisterDraft => ({
  code: "",
  name: "",
  category: "",
  acquisitionDate: today(),
  cost: "",
  salvageValue: "",
  method: "STRAIGHT_LINE",
  lifeMonths: "",
  annualRate: "",
  assetAccountCode: "1113",
  accumulatedAccountCode: "1120",
  expenseAccountCode: "5060",
});

const emptyDispose = (): DisposeDraft => ({
  date: today(),
  proceeds: "0",
  role: SETTLEMENT_EMPTY,
  settlementAccountCode: "",
  note: "",
});

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [registerSummary, setRegisterSummary] = useState<FixedAssetRegisterResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [disposal, setDisposal] = useState<FixedAssetDisposalResult | null>(null);
  const [runResult, setRunResult] = useState<DepreciationRunResult | null>(null);
  const [runYear, setRunYear] = useState("1405");
  const [runMonth, setRunMonth] = useState(1);
  const [schedule, setSchedule] = useState<DepreciationScheduleResult | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleCode, setScheduleCode] = useState<string | null>(null);
  const [register, setRegister] = useState<RegisterDraft>(emptyRegister);
  const [disposeFor, setDisposeFor] = useState<FixedAsset | null>(null);
  const [dispose, setDispose] = useState<DisposeDraft>(emptyDispose);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listFixedAssets(controller.signal),
      getFixedAssetRegister(controller.signal),
    ])
      .then(([items, reg]) => {
        setAssets(items);
        setRegisterSummary(reg);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  const reload = async () => {
    const [items, reg] = await Promise.all([listFixedAssets(), getFixedAssetRegister()]);
    setAssets(items);
    setRegisterSummary(reg);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const registerValid =
    CODE_RE.test(register.code.trim()) &&
    register.name.trim().length > 0 &&
    register.category.trim().length > 0 &&
    Boolean(register.acquisitionDate) &&
    MONEY_RE.test(register.cost.trim()) &&
    (register.salvageValue.trim() === "" || MONEY_RE.test(register.salvageValue.trim())) &&
    (register.method === "STRAIGHT_LINE"
      ? /^\d+$/.test(register.lifeMonths.trim()) && Number(register.lifeMonths) >= 1
      : ANNUAL_RATE_RE.test(register.annualRate.trim())) &&
    ACCOUNT_RE.test(register.assetAccountCode.trim()) &&
    ACCOUNT_RE.test(register.accumulatedAccountCode.trim()) &&
    ACCOUNT_RE.test(register.expenseAccountCode.trim());

  const settlementReady =
    (dispose.role !== SETTLEMENT_EMPTY && dispose.role !== SETTLEMENT_CUSTOM) ||
    (dispose.role === SETTLEMENT_CUSTOM && ACCOUNT_RE.test(dispose.settlementAccountCode.trim()));
  const disposeValid = Boolean(dispose.date) && MONEY_RE.test(dispose.proceeds.trim()) && settlementReady;

  const submitRegister = () =>
    run(async () => {
      await createFixedAsset({
        code: register.code.trim(),
        name: register.name.trim(),
        category: register.category.trim(),
        acquisitionDate: register.acquisitionDate,
        cost: register.cost.trim(),
        ...(register.salvageValue.trim() ? { salvageValue: register.salvageValue.trim() } : {}),
        method: register.method,
        ...(register.method === "STRAIGHT_LINE"
          ? { lifeMonths: Number(register.lifeMonths) }
          : { annualRate: register.annualRate.trim() }),
        assetAccountCode: register.assetAccountCode.trim(),
        accumulatedAccountCode: register.accumulatedAccountCode.trim(),
        expenseAccountCode: register.expenseAccountCode.trim(),
      });
      setRegister(emptyRegister());
      setNotice("دارایی ثبت شد.");
      setDisposal(null);
      await reload();
    });

  const openDispose = (asset: FixedAsset) => {
    setDisposeFor(asset);
    setDispose(emptyDispose());
    setDisposal(null);
  };

  const submitDispose = () =>
    run(async () => {
      if (!disposeFor) return;
      const role = dispose.role as CashAccountRole;
      const result = await disposeFixedAsset(disposeFor.id, {
        date: dispose.date,
        proceeds: dispose.proceeds.trim(),
        ...(dispose.role === SETTLEMENT_CUSTOM
          ? { settlementAccountCode: dispose.settlementAccountCode.trim() }
          : { cashAccountRole: role }),
        ...(dispose.note.trim() ? { note: dispose.note.trim() } : {}),
      });
      setDisposal(result);
      setDisposeFor(null);
      setNotice("فروش دارایی ثبت شد.");
      await reload();
    });

  const openSchedule = async (asset: FixedAsset) => {
    setScheduleCode(asset.code);
    setSchedule(null);
    setScheduleLoading(true);
    setError(null);
    try {
      const data = await getFixedAssetSchedule(asset.code);
      setSchedule(data);
    } catch (err) {
      setError(loadErrorMessage(err));
      setScheduleCode(null);
    } finally {
      setScheduleLoading(false);
    }
  };

  const submitDepreciationRun = () =>
    run(async () => {
      if (!isValidJalaliPeriod(runYear, runMonth)) return;
      const result = await runMonthlyDepreciation({
        year: Number(runYear),
        month: runMonth,
      });
      setRunResult(result);
      setNotice(formatDepreciationRunSummary(result));
      await reload();
    });

  const exportRegister = (format: "xlsx" | "pdf") =>
    run(async () => {
      await downloadFixedAssetRegister(format);
    });

  const exportSchedule = (code: string, format: "xlsx" | "pdf") =>
    run(async () => {
      await downloadFixedAssetSchedule(code, format);
    });

  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="دارایی‌های ثابت"
        description="ثبت دارایی، دفتر دارایی ثابت، استهلاک ماهانه، جدول استهلاک و فروش دارایی"
        icon={<Building2 className="size-6 text-primary" />}
      />
      <ErrorNotice title="انجام نشد" message={error} />
      {notice && <p role="status" className="text-sm text-emerald-600">{notice}</p>}
      {disposal && (
        <Card>
          <CardContent className="grid gap-1 text-sm" role="status">
            <p>
              سند فروش <span className="font-bold tabular-nums" dir="ltr">{disposal.journalEntryNumber}</span> در تاریخ{" "}
              {formatJalaliDate(disposal.date)} ثبت شد.
            </p>
            <p className="tabular-nums">
              {disposal.gain !== "0.00"
                ? `سود فروش: ${formatMoneyRial(disposal.gain)}`
                : disposal.loss !== "0.00"
                  ? `زیان فروش: ${formatMoneyRial(disposal.loss)}`
                  : "سود و زیانی نداشت."}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>دفتر دارایی‌های ثابت</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => exportRegister("xlsx")}
            >
              <FileSpreadsheet className="me-1.5 size-4" />
              خروجی اکسل (XLSX)
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => exportRegister("pdf")}
            >
              <Download className="me-1.5 size-4" />
              خروجی PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">تعداد دارایی‌ها</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatNumber(registerSummary?.rows.length ?? assets.length)}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">جمع بهای تمام‌شده</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatMoneyRial(registerSummary?.totals.costMinor ?? "0")}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">جمع استهلاک انباشته</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatMoneyRial(registerSummary?.totals.accumulatedMinor ?? "0")}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">جمع ارزش دفتری</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatMoneyRial(registerSummary?.totals.bookValueMinor ?? "0")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" />
            ثبت استهلاک ماهانه
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="dep-year">سال شمسی</Label>
              <Input
                id="dep-year"
                dir="ltr"
                inputMode="numeric"
                className="w-24"
                value={runYear}
                onChange={(e) => setRunYear(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="dep-month">ماه شمسی</Label>
              <select
                id="dep-month"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={runMonth}
                onChange={(e) => setRunMonth(Number(e.target.value))}
              >
                {JALALI_MONTH_NAMES.map((item) => (
                  <option key={item.month} value={item.month}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <Button
              disabled={busy || !isValidJalaliPeriod(runYear, runMonth)}
              onClick={submitDepreciationRun}
            >
              ثبت سند استهلاک ماهانه
            </Button>
          </div>
          {runResult && (
            <div className="rounded-md border p-3 text-sm" role="status">
              <p>{formatDepreciationRunSummary(runResult)}</p>
              {runResult.skipped.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  ردشده:{" "}
                  {runResult.skipped
                    .map((item) => `${item.code} (${SKIPPED_REASON_LABELS[item.reason]})`)
                    .join("، ")}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ثبت دارایی</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="fa-code">کد</Label>
              <Input id="fa-code" dir="ltr" className="w-32" value={register.code} onChange={(e) => setRegister({ ...register, code: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="fa-name">نام</Label>
              <Input id="fa-name" value={register.name} onChange={(e) => setRegister({ ...register, name: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="fa-category">دسته</Label>
              <Input id="fa-category" className="w-40" value={register.category} onChange={(e) => setRegister({ ...register, category: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="fa-date">تاریخ خرید</Label>
              <JalaliDateInput id="fa-date" value={register.acquisitionDate} onChange={(acquisitionDate) => setRegister({ ...register, acquisitionDate })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="fa-cost">بهای تمام‌شده (ریال)</Label>
              <Input id="fa-cost" dir="ltr" inputMode="decimal" className="w-40" value={register.cost} onChange={(e) => setRegister({ ...register, cost: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="fa-salvage">ارزش اسقاط (اختیاری)</Label>
              <Input id="fa-salvage" dir="ltr" inputMode="decimal" className="w-32" value={register.salvageValue} onChange={(e) => setRegister({ ...register, salvageValue: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="fa-method">روش استهلاک</Label>
              <select
                id="fa-method"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={register.method}
                onChange={(e) => setRegister({ ...register, method: e.target.value as FixedAssetMethod })}
              >
                <option value="STRAIGHT_LINE">خط مستقیم</option>
                <option value="DECLINING_BALANCE">نزولی</option>
              </select>
            </div>
            {register.method === "STRAIGHT_LINE" ? (
              <div className="grid gap-1">
                <Label htmlFor="fa-life">عمر مفید (ماه)</Label>
                <Input id="fa-life" dir="ltr" inputMode="numeric" className="w-24" value={register.lifeMonths} onChange={(e) => setRegister({ ...register, lifeMonths: e.target.value })} />
              </div>
            ) : (
              <div className="grid gap-1">
                <Label htmlFor="fa-rate">نرخ سالانه (۰ تا ۱)</Label>
                <Input id="fa-rate" dir="ltr" inputMode="decimal" className="w-24" value={register.annualRate} onChange={(e) => setRegister({ ...register, annualRate: e.target.value })} />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="fa-asset-account">حساب دارایی</Label>
              <Input id="fa-asset-account" dir="ltr" className="w-28" value={register.assetAccountCode} onChange={(e) => setRegister({ ...register, assetAccountCode: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="fa-accumulated-account">حساب استهلاک انباشته</Label>
              <Input id="fa-accumulated-account" dir="ltr" className="w-28" value={register.accumulatedAccountCode} onChange={(e) => setRegister({ ...register, accumulatedAccountCode: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="fa-expense-account">حساب هزینه استهلاک</Label>
              <Input id="fa-expense-account" dir="ltr" className="w-28" value={register.expenseAccountCode} onChange={(e) => setRegister({ ...register, expenseAccountCode: e.target.value })} />
            </div>
            <Button disabled={busy || !registerValid} onClick={submitRegister}>
              ثبت دارایی
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>فهرست دارایی‌ها</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>کد</TableHead>
                  <TableHead>نام</TableHead>
                  <TableHead>دسته</TableHead>
                  <TableHead>تاریخ خرید</TableHead>
                  <TableHead className="text-left">بهای تمام‌شده</TableHead>
                  <TableHead className="text-left">استهلاک انباشته</TableHead>
                  <TableHead className="text-left">ارزش دفتری</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((asset) => (
                  <TableRow key={asset.id}>
                    <TableCell dir="ltr">{asset.code}</TableCell>
                    <TableCell>{asset.name}</TableCell>
                    <TableCell>{asset.category}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatJalaliDate(asset.acquisitionDate)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatMoneyRial(asset.cost)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatMoneyRial(asset.accumulatedDepreciation)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatMoneyRial(asset.netBookValue)}</TableCell>
                    <TableCell>
                      <Badge variant={asset.status === "DISPOSED" ? "outline" : "secondary"}>
                        {FIXED_ASSET_STATUS_LABELS[asset.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => openSchedule(asset)}>
                          جدول استهلاک
                        </Button>
                        {asset.status !== "DISPOSED" && (
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => openDispose(asset)}>
                            فروش دارایی
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {assets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-sm text-muted-foreground">
                      هنوز دارایی‌ای ثبت نشده است.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Drawer
        open={disposeFor !== null}
        title={disposeFor ? `فروش دارایی ${disposeFor.code}` : "فروش دارایی"}
        description="سند فروش با استهلاک انباشتهٔ سندهای ثبت‌شده و سود یا زیان فروش، یک‌جا در دفتر ثبت می‌شود."
        size="md"
        onClose={() => setDisposeFor(null)}
      >
        <div className="grid gap-4">
          {disposeFor && (
            <p className="text-sm text-muted-foreground">
              {disposeFor.name} — بها {formatMoneyRial(disposeFor.cost)}، استهلاک انباشته{" "}
              {formatMoneyRial(disposeFor.accumulatedDepreciation)}، ارزش دفتری{" "}
              {formatMoneyRial(disposeFor.netBookValue)}.
            </p>
          )}
          <div className="grid gap-1">
            <Label htmlFor="dispose-date">تاریخ فروش</Label>
            <JalaliDateInput id="dispose-date" value={dispose.date} onChange={(date) => setDispose({ ...dispose, date })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="dispose-proceeds">عواید فروش (ریال؛ صفر مجاز است)</Label>
            <Input
              id="dispose-proceeds"
              dir="ltr"
              inputMode="decimal"
              value={dispose.proceeds}
              onChange={(e) => setDispose({ ...dispose, proceeds: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="dispose-settlement">محل تسویه عواید</Label>
            <select
              id="dispose-settlement"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={dispose.role}
              onChange={(e) => setDispose({ ...dispose, role: e.target.value })}
            >
              <option value={SETTLEMENT_EMPTY}>انتخاب کنید</option>
              {CASH_ACCOUNT_ROLES.map((option) => (
                <option key={option.role} value={option.role}>
                  {option.label}
                </option>
              ))}
              <option value={SETTLEMENT_CUSTOM}>حساب دیگر (کد دستی)</option>
            </select>
          </div>
          {dispose.role === SETTLEMENT_CUSTOM && (
            <div className="grid gap-1">
              <Label htmlFor="dispose-account">کد حساب تسویه</Label>
              <Input
                id="dispose-account"
                dir="ltr"
                className="w-32"
                value={dispose.settlementAccountCode}
                onChange={(e) => setDispose({ ...dispose, settlementAccountCode: e.target.value })}
              />
            </div>
          )}
          <div className="grid gap-1">
            <Label htmlFor="dispose-note">یادداشت (اختیاری)</Label>
            <Input id="dispose-note" value={dispose.note} onChange={(e) => setDispose({ ...dispose, note: e.target.value })} />
          </div>
          <Button disabled={busy || !disposeValid} onClick={submitDispose}>
            ثبت فروش
          </Button>
        </div>
      </Drawer>

      <Drawer
        open={scheduleCode !== null}
        title={schedule ? `جدول استهلاک ${schedule.assetCode}` : `جدول استهلاک ${scheduleCode ?? ""}`}
        description={
          schedule
            ? `${schedule.assetName} — روش ${FIXED_ASSET_METHOD_LABELS[schedule.method]}`
            : "در حال بارگذاری جدول استهلاک..."
        }
        size="lg"
        onClose={() => {
          setScheduleCode(null);
          setSchedule(null);
        }}
      >
        {scheduleLoading && <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>}
        {schedule && (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                استهلاک انباشته آغاز دوره: {formatMoneyRial(schedule.openingAccumulatedMinor)} | ارزش دفتری پایان دوره:{" "}
                {formatMoneyRial(schedule.closingBookValueMinor)}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => exportSchedule(schedule.assetCode, "xlsx")}
                >
                  <FileSpreadsheet className="me-1.5 size-4" />
                  خروجی اکسل
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => exportSchedule(schedule.assetCode, "pdf")}
                >
                  <Download className="me-1.5 size-4" />
                  خروجی PDF
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>دوره</TableHead>
                    <TableHead>تاریخ</TableHead>
                    <TableHead className="text-end">هزینه استهلاک</TableHead>
                    <TableHead className="text-end">استهلاک انباشته</TableHead>
                    <TableHead className="text-end">ارزش دفتری</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedule.rows.map((row) => (
                    <TableRow key={row.period}>
                      <TableCell className="tabular-nums">{formatNumber(row.period)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatJalaliDate(row.day)}</TableCell>
                      <TableCell className="text-end tabular-nums">{formatMoneyRial(row.chargeMinor)}</TableCell>
                      <TableCell className="text-end tabular-nums">{formatMoneyRial(row.accumulatedMinor)}</TableCell>
                      <TableCell className="text-end tabular-nums">{formatMoneyRial(row.bookValueMinor)}</TableCell>
                    </TableRow>
                  ))}
                  {schedule.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        دورهٔ استهلاک باقی‌مانده‌ای برای این دارایی وجود ندارد.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </Drawer>
    </EnterpriseRouteGuard>
  );
}
