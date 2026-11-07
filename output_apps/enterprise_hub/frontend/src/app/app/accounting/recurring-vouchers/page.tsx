"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";

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
  createRecurringVoucher,
  deleteRecurringVoucher,
  listRecurringVouchers,
  runDueRecurringVouchers,
  updateRecurringVoucher,
} from "@/lib/api/recurring-vouchers-client";
import { formatJalaliDate } from "@/lib/fa-format";
import {
  FREQUENCY_LABELS,
  type RecurringVoucher,
  type RecurringVoucherFrequency,
  type RunRecurringVouchersResult,
} from "@/types/recurring-vouchers";

interface DraftLine {
  accountCode: string;
  debit: string;
  credit: string;
  description: string;
}

interface Draft {
  name: string;
  description: string;
  frequency: RecurringVoucherFrequency;
  nextRunDate: string;
  endDate: string;
  autoReverse: boolean;
  active: boolean;
  lines: DraftLine[];
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): DraftLine => ({ accountCode: "", debit: "", credit: "", description: "" });
const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  frequency: "MONTHLY",
  nextRunDate: todayIso(),
  endDate: "",
  autoReverse: false,
  active: true,
  lines: [emptyLine(), emptyLine()],
});

export default function RecurringVouchersPage() {
  const [templates, setTemplates] = useState<RecurringVoucher[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [runDate, setRunDate] = useState(todayIso());
  const [result, setResult] = useState<RunRecurringVouchersResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listRecurringVouchers(controller.signal)
      .then(setTemplates)
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      setTemplates(await listRecurringVouchers());
      if (message) setNotice(message);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));

  const submit = () =>
    run(async () => {
      const lines = draft.lines
        .filter((line) => line.accountCode.trim())
        .map((line) => ({
          accountCode: line.accountCode.trim(),
          debit: line.debit.trim() || undefined,
          credit: line.credit.trim() || undefined,
          description: line.description.trim() || undefined,
        }));
      await createRecurringVoucher({
        name: draft.name.trim(),
        description: draft.description.trim(),
        lines,
        frequency: draft.frequency,
        nextRunDate: draft.nextRunDate,
        endDate: draft.endDate || undefined,
        autoReverse: draft.autoReverse,
        active: draft.active,
      });
      setDraft(emptyDraft());
      return "الگوی سند دوره‌ای ثبت شد.";
    });

  const toggleActive = (template: RecurringVoucher) =>
    run(async () => {
      await updateRecurringVoucher(template.id, { active: !template.active });
      return template.active ? "الگو غیرفعال شد." : "الگو فعال شد.";
    });

  const remove = (template: RecurringVoucher) =>
    run(async () => {
      await deleteRecurringVoucher(template.id);
      return "الگو حذف شد.";
    });

  const runDue = () =>
    run(async () => {
      const outcome = await runDueRecurringVouchers(runDate);
      setResult(outcome);
      return null;
    });

  const validDraft =
    draft.name.trim() &&
    draft.description.trim() &&
    draft.nextRunDate &&
    draft.lines.filter((line) => line.accountCode.trim()).length >= 2;

  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="اسناد دوره‌ای"
        description="الگوهای تکرارشونده و تعهدهای خودکار با برگشت در ابتدای ماه بعد"
        icon={<CalendarClock className="size-6 text-indigo-500" />}
      />
      <ErrorNotice title="انجام نشد" message={error} />
      {notice && <p role="status" className="text-sm text-emerald-600">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle>اجرای موارد سررسیده</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="run-date">تاریخ اجرا</Label>
              <JalaliDateInput id="run-date" value={runDate} onChange={setRunDate} />
            </div>
            <Button disabled={busy || !runDate} onClick={runDue}>
              اجرای موارد سررسیده
            </Button>
          </div>
          {result && (
            <div className="grid gap-2" role="status">
              <p className="text-sm">
                ایجادشده: <span className="font-bold tabular-nums">{result.created}</span> — برگشت‌خورده:{" "}
                <span className="font-bold tabular-nums">{result.reversed}</span>
              </p>
              {result.skipped.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>شناسه الگو</TableHead>
                      <TableHead>تاریخ سررسید</TableHead>
                      <TableHead>دلیل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.skipped.map((row, index) => (
                      <TableRow key={`${row.id}-${row.date}-${index}`}>
                        <TableCell className="tabular-nums">{row.id}</TableCell>
                        <TableCell>{formatJalaliDate(row.date)}</TableCell>
                        <TableCell className="min-w-56 whitespace-normal">{row.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>الگوها</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="rv-name">نام</Label>
              <Input id="rv-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="rv-description">شرح سند</Label>
              <Input
                id="rv-description"
                className="w-64"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="rv-frequency">دوره</Label>
              <select
                id="rv-frequency"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={draft.frequency}
                onChange={(e) => setDraft({ ...draft, frequency: e.target.value as RecurringVoucherFrequency })}
              >
                {(Object.keys(FREQUENCY_LABELS) as RecurringVoucherFrequency[]).map((key) => (
                  <option key={key} value={key}>
                    {FREQUENCY_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="rv-next">اجرای بعدی</Label>
              <JalaliDateInput
                id="rv-next"
                value={draft.nextRunDate}
                onChange={(nextRunDate) => setDraft({ ...draft, nextRunDate })}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="rv-end">پایان (اختیاری)</Label>
              <JalaliDateInput
                id="rv-end"
                value={draft.endDate}
                onChange={(endDate) => setDraft({ ...draft, endDate })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.autoReverse}
                onChange={(e) => setDraft({ ...draft, autoReverse: e.target.checked })}
              />
              تعهد خودکار و برگشت
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              فعال
            </label>
          </div>

          <div className="grid gap-2">
            <p className="text-sm font-medium">سطرهای سند</p>
            {draft.lines.map((line, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1">
                  <Label htmlFor={`rv-line-account-${index}`}>حساب</Label>
                  <Input
                    id={`rv-line-account-${index}`}
                    dir="ltr"
                    className="w-28"
                    value={line.accountCode}
                    onChange={(e) => updateLine(index, { accountCode: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`rv-line-debit-${index}`}>بدهکار</Label>
                  <Input
                    id={`rv-line-debit-${index}`}
                    dir="ltr"
                    inputMode="decimal"
                    className="w-32"
                    value={line.debit}
                    onChange={(e) => updateLine(index, { debit: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`rv-line-credit-${index}`}>بستانکار</Label>
                  <Input
                    id={`rv-line-credit-${index}`}
                    dir="ltr"
                    inputMode="decimal"
                    className="w-32"
                    value={line.credit}
                    onChange={(e) => updateLine(index, { credit: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`rv-line-desc-${index}`}>شرح سطر</Label>
                  <Input
                    id={`rv-line-desc-${index}`}
                    value={line.description}
                    onChange={(e) => updateLine(index, { description: e.target.value })}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="حذف سطر"
                  disabled={draft.lines.length <= 2}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      lines: current.lines.filter((_, i) => i !== index),
                    }))
                  }
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, emptyLine()] }))}
            >
              <Plus className="size-4" aria-hidden="true" />
              افزودن سطر
            </Button>
          </div>

          <Button disabled={busy || !validDraft} onClick={submit}>
            ثبت الگو
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>فهرست الگوها</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>نام</TableHead>
                <TableHead>دوره</TableHead>
                <TableHead>اجرای بعدی</TableHead>
                <TableHead>پایان</TableHead>
                <TableHead>برگشت خودکار</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell>{template.name}</TableCell>
                  <TableCell>{FREQUENCY_LABELS[template.frequency]}</TableCell>
                  <TableCell>{formatJalaliDate(template.nextRunDate)}</TableCell>
                  <TableCell>{template.endDate ? formatJalaliDate(template.endDate) : "—"}</TableCell>
                  <TableCell>{template.autoReverse ? "بله" : "خیر"}</TableCell>
                  <TableCell>
                    <Badge variant={template.active ? "secondary" : "outline"}>
                      {template.active ? "فعال" : "غیرفعال"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-left">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => toggleActive(template)}>
                        {template.active ? "غیرفعال‌سازی" : "فعال‌سازی"}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove(template)}>
                        حذف
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {templates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    هنوز الگویی تعریف نشده است.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </EnterpriseRouteGuard>
  );
}
