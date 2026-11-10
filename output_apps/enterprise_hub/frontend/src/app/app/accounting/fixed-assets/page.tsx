"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";

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
  listFixedAssets,
  type CashAccountRole,
  type FixedAsset,
  type FixedAssetDisposalResult,
  type FixedAssetMethod,
  type FixedAssetStatus,
} from "@/lib/api/fixed-assets-client";
import { formatJalaliDate, formatReportMoney } from "@/lib/fa-format";

const STATUS_LABELS: Record<FixedAssetStatus, string> = {
  ACTIVE: "فعال",
  FULLY_DEPRECIATED: "کاملاً مستهلک",
  DISPOSED: "فروش‌رفته",
};

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [disposal, setDisposal] = useState<FixedAssetDisposalResult | null>(null);
  const [register, setRegister] = useState<RegisterDraft>(emptyRegister);
  const [disposeFor, setDisposeFor] = useState<FixedAsset | null>(null);
  const [dispose, setDispose] = useState<DisposeDraft>(emptyDispose);

  useEffect(() => {
    const controller = new AbortController();
    listFixedAssets(controller.signal)
      .then(setAssets)
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  const reload = async () => {
    setAssets(await listFixedAssets());
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

  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="دارایی‌های ثابت"
        description="ثبت دارایی، استهلاک انباشته، ارزش دفتری و فروش دارایی با سند سود یا زیان"
        icon={<Building2 className="size-6 text-indigo-500" />}
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
                ? `سود فروش: ${formatReportMoney(disposal.gain)} ریال`
                : disposal.loss !== "0.00"
                  ? `زیان فروش: ${formatReportMoney(disposal.loss)} ریال`
                  : "سود و زیانی نداشت."}
            </p>
          </CardContent>
        </Card>
      )}

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
                    <TableCell className="text-left tabular-nums">{formatReportMoney(asset.cost)}</TableCell>
                    <TableCell className="text-left tabular-nums">{formatReportMoney(asset.accumulatedDepreciation)}</TableCell>
                    <TableCell className="text-left tabular-nums">{formatReportMoney(asset.netBookValue)}</TableCell>
                    <TableCell>
                      <Badge variant={asset.status === "DISPOSED" ? "outline" : "secondary"}>{STATUS_LABELS[asset.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-left">
                      {asset.status !== "DISPOSED" && (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => openDispose(asset)}>
                          فروش دارایی
                        </Button>
                      )}
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
              {disposeFor.name} — بها {formatReportMoney(disposeFor.cost)} ریال، استهلاک انباشته{" "}
              {formatReportMoney(disposeFor.accumulatedDepreciation)} ریال، ارزش دفتری{" "}
              {formatReportMoney(disposeFor.netBookValue)} ریال.
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
    </EnterpriseRouteGuard>
  );
}
