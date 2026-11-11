"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TriangleAlert, ArrowRight, BookCheck, Calculator, Download, FileText, Printer, Wallet } from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader, StatCard, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  createPayrollRun,
  getInsuranceList,
  getPayrollRates,
  getPayrollRun,
  getWageTaxFiles,
  listPayrollRuns,
  postPayrollRun,
} from "@/lib/api/hr-client";
import { formatJalaliDateTime, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { printPayslip } from "@/lib/print/open-payslip-window";
import { payrollSteps } from "@/lib/payroll-steps";
import { PayrollStepper } from "@/components/hr/payroll-steps";
import type { InsuranceListQuery, PayrollRun, PayrollRunItem, Payslip } from "@/types/hr";

const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

type InputKey = Exclude<keyof PayrollRunItem, "employeeId">;

const INPUT_COLUMNS: Array<[InputKey, string]> = [
  ["overtimeHours", "اضافه‌کاری (ساعت)"],
  ["nightHours", "شب‌کاری (ساعت)"],
  ["holidayHours", "تعطیل‌کاری (ساعت)"],
  ["absenceDays", "غیبت (روز)"],
  ["otherDeductions", "سایر کسورات (ریال)"],
  ["eidi", "عیدی (ریال)"],
];

/** Current Jalali year and month in the browser's clock. */
function currentJalaliPeriod(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: pick("year") || 1405, month: pick("month") || 1 };
}

function periodLabel(year: number, month: number): string {
  return `${JALALI_MONTHS[month - 1] ?? month} ${formatNumber(year).replace(/٬/g, "")}`;
}

function downloadBase64(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadText(fileName: string, content: string) {
  // BOM so that spreadsheet tools open the UTF-8 Persian text correctly.
  const blob = new Blob(["﻿", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PayrollPage() {
  const [initial] = useState(currentJalaliPeriod);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [inputs, setInputs] = useState<Record<number, PayrollRunItem>>({});
  const [selected, setSelected] = useState<Payslip | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Unverified statutory keys per Jalali year; a year missing from the map is not (yet) known.
  const [unverified, setUnverified] = useState<Record<number, string[]>>({});

  useEffect(() => {
    const controller = new AbortController();
    getPayrollRates(year, controller.signal)
      .then((rates) => setUnverified((prev) => ({ ...prev, [year]: rates.unverifiedKeys })))
      .catch(() => {
        // Unknown year or network error: the calculation itself reports the real problem.
      });
    return () => controller.abort();
  }, [year]);

  useEffect(() => {
    const controller = new AbortController();
    listPayrollRuns(controller.signal)
      .then(setRuns)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, [refreshKey]);

  function applyRun(next: PayrollRun) {
    setRun(next);
    setYear(next.periodYear);
    setMonth(next.periodMonth);
    setSelected(null);
    const map: Record<number, PayrollRunItem> = {};
    for (const p of next.payslips) {
      map[p.employeeId] = {
        employeeId: p.employeeId,
        overtimeHours: p.overtimeHours ?? 0,
        nightHours: p.nightHours ?? 0,
        holidayHours: p.holidayHours ?? 0,
        absenceDays: p.absenceDays ?? 0,
        otherDeductions: p.otherDeductions ?? 0,
      };
    }
    setInputs(map);
  }

  async function perform(action: () => Promise<PayrollRun>) {
    setBusy(true);
    setError(null);
    try {
      applyRun(await action());
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const calculate = () =>
    perform(() =>
      createPayrollRun({
        periodYear: year,
        periodMonth: month,
        items: run && run.periodYear === year && run.periodMonth === month ? Object.values(inputs) : undefined,
      }),
    );

  const post = () => {
    if (!run) return;
    if (!window.confirm("پس از ثبت سند، حقوق این ماه قفل می‌شود. ادامه می‌دهید؟")) return;
    void perform(() => postPayrollRun(run.id));
  };

  function setInput(employeeId: number, key: InputKey, raw: string) {
    const value = Math.max(0, Number(raw) || 0);
    setInputs((prev) => ({
      ...prev,
      [employeeId]: { ...(prev[employeeId] ?? { employeeId }), [key]: value },
    }));
  }

  const draft = run?.status === "DRAFT";

  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="حقوق و دستمزد ماهانه"
        description="محاسبه حقوق طبق قانون کار، فیش حقوقی، ثبت سند حسابداری و لیست بیمه"
        icon={<Wallet className="size-6 text-indigo-500" />}
        actions={
          <Link href="/app/hr" className={buttonVariants({ variant: "outline" })}>
            <ArrowRight />
            بازگشت به کارکنان
          </Link>
        }
      />

      <PayrollStepper view={payrollSteps(run ?? null, (run?.payslips?.length ?? 0) > 0)} />

      <ErrorNotice title="عملیات حقوق انجام نشد" message={error} />

      {(unverified[year]?.length ?? 0) > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
        >
          <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
            <TriangleAlert />
            تأییدنشده
          </Badge>
          <span>
            {formatNumber(unverified[year].length)} مقدار قانونی سال {formatNumber(year).replace(/٬/g, "")} با متن
            رسمی تطبیق نشده است؛ پیش از ثبت سند، حسابدار آن‌ها را بررسی کند.
          </span>
          <Link href="/app/hr/statutory" className="underline underline-offset-4">
            مشاهده مقادیر و منابع
          </Link>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>دوره حقوق</CardTitle>
          <CardDescription>
            همه کارکنان شاغل با قرارداد فعال محاسبه می‌شوند. تا پیش از ثبت سند، می‌توانید ساعات
            و غیبت را ویرایش و دوباره محاسبه کنید.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="payroll-year">سال</Label>
            <Input
              id="payroll-year"
              type="number"
              dir="ltr"
              className="w-28"
              value={year}
              min={1390}
              max={1450}
              onChange={(e) => setYear(Number(e.target.value) || initial.year)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="payroll-month">ماه</Label>
            <select
              id="payroll-month"
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {JALALI_MONTHS.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={calculate} disabled={busy || run?.status === "POSTED"}>
            <Calculator />
            {run && run.periodYear === year && run.periodMonth === month ? "محاسبه مجدد" : "محاسبه حقوق"}
          </Button>
          {draft && (
            <Button variant="secondary" onClick={post} disabled={busy || run.employeeCount === 0}>
              <BookCheck />
              ثبت سند در حسابداری
            </Button>
          )}
          <LoadingLine show={busy} />
        </CardContent>
        {runs.length > 0 && (
          <CardContent className="flex flex-wrap gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">دوره‌های قبلی:</span>
            {runs.map((r) => (
              <Button
                key={r.id}
                size="xs"
                variant={run?.id === r.id ? "default" : "outline"}
                onClick={() => perform(() => getPayrollRun(r.id))}
              >
                {periodLabel(r.periodYear, r.periodMonth)} · {r.statusLabel}
              </Button>
            ))}
          </CardContent>
        )}
      </Card>

      {run && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{periodLabel(run.periodYear, run.periodMonth)}</h2>
            <Badge variant={draft ? "secondary" : "default"}>{run.statusLabel}</Badge>
            {run.journalEntryNumber && (
              <span className="text-xs text-muted-foreground">
                سند {run.journalEntryNumber} · {formatJalaliDateTime(run.postedAt)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="جمع حقوق و مزایا" value={formatMoneyRial(run.totalGross)} hint={`${formatNumber(run.employeeCount)} نفر`} />
            <StatCard label="بیمه سهم کارگر" value={formatMoneyRial(run.totalEmployeeInsurance)} />
            <StatCard
              label="بیمه سهم کارفرما"
              value={formatMoneyRial(run.totalEmployerInsurance)}
              hint={`بیمه بیکاری: ${formatMoneyRial(run.totalUnemploymentInsurance)}`}
            />
            <StatCard label="مالیات حقوق" value={formatMoneyRial(run.totalIncomeTax)} />
            <StatCard label="خالص پرداختی" value={formatMoneyRial(run.totalNet)} />
          </div>

          {run?.status === "POSTED" && (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>فایل‌های قانونی</CardTitle>
              </CardHeader>
              <CardContent>
                فایل‌های بیمه و مالیات حقوق این ماه از صفحه پارامترهای قانونی ساخته می‌شوند.
                <Link href="/app/hr/statutory" className="block mt-2 underline underline-offset-4 text-primary">
                  رفتن به بیمه و مالیات حقوق
                </Link>
              </CardContent>
            </Card>
          )}

          {run.skipped.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>محاسبه نشده</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc text-sm text-muted-foreground">
                  {run.skipped.map((s) => (
                    <li key={s.employeeId}>
                      {s.employeeFullName}: {s.reason}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>فیش‌های این ماه</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>کارمند</TableHead>
                    {INPUT_COLUMNS.map(([key, label]) => (
                      <TableHead key={key}>{label}</TableHead>
                    ))}
                    <TableHead>ناخالص</TableHead>
                    <TableHead>بیمه کارگر</TableHead>
                    <TableHead>مالیات</TableHead>
                    <TableHead>خالص</TableHead>
                    <TableHead>
                      <span className="sr-only">فیش</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.payslips.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={INPUT_COLUMNS.length + 6} className="py-8 text-center text-muted-foreground">
                        کارمند شاغلی با قرارداد فعال یافت نشد.
                      </TableCell>
                    </TableRow>
                  )}
                  {run.payslips.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium whitespace-nowrap">{p.employeeFullName}</TableCell>
                      {INPUT_COLUMNS.map(([key, label]) => (
                        <TableCell key={key}>
                          {draft ? (
                            <Input
                              type="number"
                              dir="ltr"
                              min={0}
                              className="w-24"
                              aria-label={`${label} — ${p.employeeFullName}`}
                              value={inputs[p.employeeId]?.[key] ?? 0}
                              onChange={(e) => setInput(p.employeeId, key, e.target.value)}
                            />
                          ) : (
                            formatNumber(Number(inputs[p.employeeId]?.[key] ?? 0))
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="whitespace-nowrap">{formatMoneyRial(p.grossPay)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatMoneyRial(p.insuranceDeduction)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatMoneyRial(p.incomeTax)}</TableCell>
                      <TableCell className="font-medium whitespace-nowrap">{formatMoneyRial(p.netPay)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setSelected(p)}>
                            <FileText />
                            فیش
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => printPayslip(p)}>
                            <Printer />
                            چاپ
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {selected && <PayslipView payslip={selected} onClose={() => setSelected(null)} />}

          <InsuranceListCard runId={run.id} />
        </>
      )}
    </EnterpriseRouteGuard>
  );
}

function PayslipView({ payslip, onClose }: { payslip: Payslip; onClose: () => void }) {
  const earnings: Array<[string, number | undefined]> = [
    ["حقوق پایه", payslip.baseSalary],
    ["پایه سنوات", payslip.seniorityAmount],
    ["حق مسکن", payslip.housingAllowance],
    ["بن کارگری", payslip.foodAllowance],
    ["حق اولاد", payslip.childAllowance],
    ["حق تأهل", payslip.marriageAllowance],
    ...(payslip.allowanceLines ?? []).map((line): [string, number] => [line.title, line.amount]),
    ["عیدی", payslip.eidiAmount],
    ["اضافه‌کاری", payslip.overtimeAmount],
    ["فوق‌العاده شب‌کاری", payslip.nightShiftAmount],
    ["تعطیل‌کاری", payslip.holidayAmount],
    ["کسر غیبت", payslip.absenceDeduction ? -payslip.absenceDeduction : 0],
  ];
  const deductions: Array<[string, number | undefined]> = [
    ["بیمه سهم کارگر", payslip.insuranceDeduction],
    ["مالیات حقوق (تجمعی)", payslip.incomeTax],
    ["سایر کسورات", payslip.otherDeductions],
  ];
  const row = ([label, amount]: [string, number | undefined]) => (
    <div key={label} className="flex justify-between gap-4 py-1 text-sm">
      <span>{label}</span>
      <span className="tabular-nums">{formatMoneyRial(amount ?? 0)}</span>
    </div>
  );

  return (
    <Card className="print:shadow-none">
      <CardHeader>
        <CardTitle>
          فیش حقوقی {payslip.employeeFullName} — {periodLabel(payslip.periodYear, payslip.periodMonth)}
        </CardTitle>
        <CardDescription>
          شماره فیش {payslip.payslipNumber} · کد پرسنلی {payslip.employeeNumber} · روزهای کارکرد{" "}
          {formatNumber(payslip.workDays ?? 0)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-3">
        <div>
          <h3 className="mb-1 font-semibold">حقوق و مزایا</h3>
          {earnings.filter(([, amount]) => amount).map(row)}
          <div className="mt-1 border-t pt-1 font-semibold">{row(["جمع حقوق و مزایا", payslip.grossPay])}</div>
        </div>
        <div>
          <h3 className="mb-1 font-semibold">کسورات</h3>
          {deductions.map(row)}
          <div className="mt-1 border-t pt-1 font-semibold">{row(["خالص پرداختی", payslip.netPay])}</div>
        </div>
        <div>
          <h3 className="mb-1 font-semibold">سهم کارفرما (اطلاعاتی)</h3>
          {row(["دستمزد مشمول بیمه", payslip.insurableWage])}
          {row(["بیمه سهم کارفرما", payslip.employerInsurance])}
          {row(["بیمه بیکاری", payslip.unemploymentInsurance])}
        </div>
      </CardContent>
      <CardContent className="flex gap-2 print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer />
          چاپ
        </Button>
        <Button variant="ghost" onClick={onClose}>
          بستن
        </Button>
      </CardContent>
    </Card>
  );
}

function InsuranceListCard({ runId }: { runId: number }) {
  const [form, setForm] = useState<InsuranceListQuery>({
    workshopCode: "",
    workshopName: "",
    employerName: "",
    contractRow: "000",
  });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const list = await getInsuranceList(runId, form);
      downloadText(list.workshopFileName, list.workshopFile);
      downloadText(list.workersFileName, list.workersFile);
      downloadBase64(list.workshopDbfFileName, list.workshopDbf);
      downloadBase64(list.workersDbfFileName, list.workersDbf);
      setWarnings(
        list.uploadReady
          ? list.warnings
          : [
              ...list.warnings,
              "قالب DBF هنوز آماده‌ی بارگذاری نیست؛ پیش از ارسال، آن را در برنامه لیست بیمه باز و کنترل کنید. موارد تأییدنشده:",
              ...(list.unverified ?? []),
            ],
      );
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function downloadTaxFiles() {
    setBusy(true);
    setError(null);
    try {
      const files = await getWageTaxFiles(runId);
      downloadText(files.wpFileName, files.wpFile);
      downloadText(files.whFileName, files.whFile);
      setWarnings(
        files.uploadReady
          ? files.warnings
          : [...files.warnings, "این‌ها فایل بارگذاری نیستند؛ موارد تأییدنشده:", ...(files.unverified ?? [])],
      );
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const fields: Array<[keyof InsuranceListQuery, string, boolean]> = [
    ["workshopCode", "کد کارگاه", true],
    ["workshopName", "نام کارگاه", false],
    ["employerName", "نام کارفرما", false],
    ["contractRow", "ردیف پیمان", true],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>لیست بیمه تأمین اجتماعی</CardTitle>
        <CardDescription>
          فایل‌های DSKKAR00 (سرجمع کارگاه) و DSKWOR00 (کارکنان) به‌صورت CSV و DBF دریافت می‌شود. جمع
          سطرهای کارکنان پیش از ساخت فایل با سرجمع کارگاه کنترل می‌شود. برگه کاری مالیات حقوق (WP و WH)
          برای کنترل است و قالب بارگذاری سامانه نیست.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {fields.map(([key, label, ltr]) => (
            <div key={key} className="grid gap-1.5">
              <Label htmlFor={`ins-${key}`}>{label}</Label>
              <Input
                id={`ins-${key}`}
                dir={ltr ? "ltr" : undefined}
                value={form[key] ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <ErrorNotice title="لیست بیمه ساخته نشد" message={error} />
        {warnings.length > 0 && (
          <ul className="list-inside list-disc text-sm text-amber-600">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={download} disabled={busy || !form.workshopCode || !form.workshopName || !form.employerName}>
            <Download />
            دریافت لیست بیمه
          </Button>
          <Button variant="outline" onClick={downloadTaxFiles} disabled={busy}>
            <Download />
            برگه کاری مالیات حقوق
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
