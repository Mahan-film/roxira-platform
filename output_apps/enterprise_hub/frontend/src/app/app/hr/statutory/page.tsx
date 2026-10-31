"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Scale, TriangleAlert } from "lucide-react";

import { useAccess } from "@/components/app/access-provider";
import { ErrorNotice, LoadingLine, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listStatutoryParameters, setStatutoryParameter } from "@/lib/api/hr-client";
import { formatNumber } from "@/lib/fa-format";
import type { StatutoryParameter } from "@/types/hr";

const SOURCE_LABELS: Record<StatutoryParameter["sourceKind"], string> = {
  OFFICIAL: "متن رسمی",
  REPORT: "گزارش پژوهشی",
  LEGACY: "مقدار پیشین",
  TENANT: "ثبت سازمان",
};

function displayValue(value: unknown): string {
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") return `${formatNumber(Number((Number(value) * 100).toFixed(4)))}٪`;
  if (Array.isArray(value)) {
    return (value as { upTo: number | null; rate: string }[])
      .map((band) =>
        band.upTo === null
          ? `مازاد: ${formatNumber(Number(band.rate) * 100)}٪`
          : `تا ${formatNumber(band.upTo)}: ${formatNumber(Number(band.rate) * 100)}٪`,
      )
      .join("، ");
  }
  return "—";
}

/** Text the form starts from: bracket lists stay JSON, numbers and rate strings stay plain. */
const editText = (value: unknown): string =>
  Array.isArray(value) ? JSON.stringify(value) : String(value ?? "");

function parseValue(original: unknown, text: string): unknown {
  if (Array.isArray(original)) return JSON.parse(text);
  return typeof original === "number" ? Number(text) : text.trim();
}

export default function StatutoryParametersPage() {
  const { can } = useAccess();
  const canEdit = can("hr", "admin");
  const [year, setYear] = useState(1405);
  const [rows, setRows] = useState<StatutoryParameter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StatutoryParameter | null>(null);
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setRows(null);
    listStatutoryParameters(year, controller.signal)
      .then(setRows)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setRows([]);
        setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, [year]);

  function startEdit(row: StatutoryParameter) {
    setEditing(row);
    setText(editText(row.value));
    setSource("");
    setVerified(false);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const next = await setStatutoryParameter({
        fiscalYear: year,
        key: editing.key,
        value: parseValue(editing.value, text),
        source,
        verified,
      });
      setRows(next);
      setEditing(null);
    } catch (err) {
      setError(err instanceof SyntaxError ? "قالب پله‌ها معتبر نیست." : loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const unverifiedCount = rows?.filter((row) => !row.verified).length ?? 0;

  return (
    <EnterpriseRouteGuard requireAdmin>
      <PageHeader
        title="پارامترهای قانونی"
        description="مقادیر هر سال مالی با تاریخ نفوذ، منبع و وضعیت تطبیق با متن رسمی"
        icon={<Scale className="size-6 text-indigo-500" />}
        actions={
          <Link href="/app/hr/payroll" className={buttonVariants({ variant: "outline" })}>
            <ArrowRight />
            بازگشت به حقوق
          </Link>
        }
      />

      <ErrorNotice title="عملیات انجام نشد" message={error} />

      <Card>
        <CardHeader>
          <CardTitle>سال مالی</CardTitle>
          <CardDescription>
            {rows === null
              ? "در حال دریافت"
              : `${formatNumber(rows.length)} مقدار، ${formatNumber(unverifiedCount)} مقدار تأییدنشده`}
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-40">
          <Label htmlFor="statutory-year">سال</Label>
          <Input
            id="statutory-year"
            type="number"
            value={year}
            onChange={(event) => setYear(Number(event.target.value) || year)}
          />
        </CardContent>
      </Card>

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>ویرایش «{editing.label}»</CardTitle>
            <CardDescription>
              نسخه جدید فقط برای همین سازمان ثبت می‌شود و نسخه‌های قبلی و گزارش ممیزی باقی می‌مانند.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="statutory-value">مقدار</Label>
              <Input id="statutory-value" dir="ltr" value={text} onChange={(event) => setText(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="statutory-source">منبع (شماره و تاریخ بخشنامه)</Label>
              <Input id="statutory-source" value={source} onChange={(event) => setSource(event.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
              />
              این مقدار را با متن رسمی تطبیق داده‌ام
            </label>
            <div className="flex gap-2">
              <Button onClick={() => void save()} disabled={busy || source.trim().length < 3}>
                ثبت نسخه جدید
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
                انصراف
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {rows === null ? (
            <LoadingLine show />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>عنوان</TableHead>
                  <TableHead>مقدار</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead>منبع</TableHead>
                  {canEdit && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="max-w-72 whitespace-normal tabular-nums">{displayValue(row.value)}</TableCell>
                    <TableCell>
                      {row.verified ? (
                        <Badge variant="outline" className="border-emerald-500/60 text-emerald-700 dark:text-emerald-400">
                          <BadgeCheck />
                          تأییدشده
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
                          <TriangleAlert />
                          تأییدنشده
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-80 whitespace-normal text-xs text-muted-foreground">
                      {SOURCE_LABELS[row.sourceKind]}: {row.source}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => startEdit(row)}>
                          ویرایش
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </EnterpriseRouteGuard>
  );
}
