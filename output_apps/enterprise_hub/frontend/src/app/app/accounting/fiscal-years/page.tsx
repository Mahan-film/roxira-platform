"use client";

import { useEffect, useState } from "react";
import { CalendarRange } from "lucide-react";

import { ErrorNotice, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  applyChartTemplate,
  closeFiscalYear,
  createFiscalYear,
  listChartTemplates,
  listFiscalYears,
  reopenFiscalYear,
} from "@/lib/api/accounting-reports-client";
import { formatJalaliDate } from "@/lib/fa-format";
import type { ChartTemplate, FiscalYear } from "@/types/accounting-reports";

const EMPTY_YEAR = { name: "", startDate: "", endDate: "" };

function YearFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: typeof EMPTY_YEAR;
  onChange: (next: typeof EMPTY_YEAR) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1">
        <Label htmlFor={`${idPrefix}-name`}>نام سال</Label>
        <Input
          id={`${idPrefix}-name`}
          className="w-28"
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${idPrefix}-start`}>شروع</Label>
        <JalaliDateInput
          id={`${idPrefix}-start`}
          value={value.startDate}
          onChange={(startDate) => onChange({ ...value, startDate })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${idPrefix}-end`}>پایان</Label>
        <JalaliDateInput
          id={`${idPrefix}-end`}
          value={value.endDate}
          onChange={(endDate) => onChange({ ...value, endDate })}
        />
      </div>
    </div>
  );
}

export default function FiscalYearsPage() {
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [templates, setTemplates] = useState<ChartTemplate[]>([]);
  const [draft, setDraft] = useState(EMPTY_YEAR);
  const [closing, setClosing] = useState<FiscalYear | null>(null);
  const [nextYear, setNextYear] = useState(EMPTY_YEAR);
  const [reopening, setReopening] = useState<FiscalYear | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [yearList, templateList] = await Promise.all([listFiscalYears(), listChartTemplates()]);
    setYears(yearList);
    setTemplates(templateList);
  };

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([listFiscalYears(controller.signal), listChartTemplates(controller.signal)])
      .then(([yearList, templateList]) => {
        setYears(yearList);
        setTemplates(templateList);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      await reload();
      setNotice(message);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const nextExists = closing ? years.some((year) => year.startDate > closing.endDate) : false;

  return (
    <EnterpriseRouteGuard requireAdmin>
      <PageHeader
        title="سال مالی و سرفصل"
        description="قالب سرفصل استاندارد، تعریف سال مالی و بستن حساب‌ها"
        icon={<CalendarRange className="size-6 text-indigo-500" />}
      />
      <ErrorNotice title="انجام نشد" message={error} />
      {notice && <p role="status" className="text-sm text-emerald-600">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle>قالب سرفصل حساب‌ها</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {templates.map((template) => (
            <div key={template.key} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">{template.name}</p>
                <p className="text-xs text-muted-foreground">{template.description}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await applyChartTemplate(template.key);
                    return `${result.added} حساب اضافه و ${result.classified} حساب طبقه‌بندی شد.`;
                  })
                }
              >
                اعمال
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سال‌های مالی</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <YearFields idPrefix="year" value={draft} onChange={setDraft} />
            <Button
              disabled={busy || !draft.name.trim() || !draft.startDate || !draft.endDate}
              onClick={() =>
                run(async () => {
                  await createFiscalYear(draft);
                  setDraft(EMPTY_YEAR);
                  return "سال مالی تعریف شد.";
                })
              }
            >
              تعریف سال
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>سال</TableHead>
                <TableHead>شروع</TableHead>
                <TableHead>پایان</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {years.map((year) => (
                <TableRow key={year.id}>
                  <TableCell>{year.name}</TableCell>
                  <TableCell>{formatJalaliDate(year.startDate)}</TableCell>
                  <TableCell>{formatJalaliDate(year.endDate)}</TableCell>
                  <TableCell>
                    <Badge variant={year.status === "OPEN" ? "secondary" : "outline"}>
                      {year.status === "OPEN" ? "باز" : "بسته"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-left">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => (year.status === "OPEN" ? setClosing(year) : setReopening(year))}
                    >
                      {year.status === "OPEN" ? "بستن سال" : "بازگشایی"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {years.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    هنوز سال مالی تعریف نشده است.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {closing && (
        <Card>
          <CardHeader>
            <CardTitle>بستن سال مالی {closing.name}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              پیش از بستن، هزینه مالیات عملکرد و اندوخته قانونی را ثبت کنید. سند بستن حساب‌های موقت، اختتامیه و افتتاحیه
              سال بعد صادر و این سال قفل می‌شود.
            </p>
            {!nextExists && <YearFields idPrefix="next" value={nextYear} onChange={setNextYear} />}
            <div className="flex gap-2">
              <Button
                disabled={busy || (!nextExists && (!nextYear.name.trim() || !nextYear.startDate || !nextYear.endDate))}
                onClick={() =>
                  run(async () => {
                    const result = await closeFiscalYear(closing.id, nextExists ? undefined : nextYear);
                    setClosing(null);
                    setNextYear(EMPTY_YEAR);
                    return `سال بسته شد. اسناد صادرشده: ${result.entryNumbers.join("، ") || "هیچ"}`;
                  })
                }
              >
                تأیید و بستن
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setClosing(null)}>
                انصراف
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {reopening && (
        <Card>
          <CardHeader>
            <CardTitle>بازگشایی سال مالی {reopening.name}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">اسناد بستن با سند برگشت خنثی می‌شوند و قفل سال برداشته می‌شود.</p>
            <div className="grid max-w-md gap-1">
              <Label htmlFor="reopen-reason">دلیل بازگشایی</Label>
              <Input id="reopen-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button
                disabled={busy || reason.trim().length < 3}
                onClick={() =>
                  run(async () => {
                    await reopenFiscalYear(reopening.id, reason);
                    setReopening(null);
                    setReason("");
                    return "سال مالی بازگشایی شد.";
                  })
                }
              >
                تأیید و بازگشایی
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setReopening(null)}>
                انصراف
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </EnterpriseRouteGuard>
  );
}
