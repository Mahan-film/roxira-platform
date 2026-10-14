"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  Wand2,
} from "lucide-react";

import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { SiteHeader } from "@/components/layout/site-header";
import { RoxiraFooter } from "@/components/layout/roxira-footer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { commitLeadImport, previewLeadImport } from "@/lib/api/data-import-client";
import { ApiClientError } from "@/lib/api/http-client";
import {
  LEAD_IMPORT_FIELD_LABELS,
  LEAD_IMPORT_FIELD_ORDER,
  type LeadImportPreview,
  type LeadImportResult,
} from "@/types/data-import";

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * صفحه ورود اطلاعات از نرم‌افزار دیگر (AI-assisted data import).
 *
 * جریان: بارگذاری فایل → نمایش نگاشت پیشنهادی با منوهای ویرایش‌پذیر →
 * تأیید و ورود → خلاصه نتیجه. همه مسیرها به ماژول
 * `enterprise-hub/data-import` لایه NestJS متصل است.
 */
export default function CrmImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<LeadImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<LeadImportResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mappedCount = useMemo(
    () => Object.values(mapping).filter((value) => value !== "").length,
    [mapping],
  );

  function describeError(error: unknown, fallback: string): string {
    if (error instanceof ApiClientError) {
      return error.details.join(" | ");
    }
    return fallback;
  }

  async function handlePreview() {
    if (!file) return;
    setIsPreviewing(true);
    setErrorMessage(null);
    setResult(null);
    try {
      const response = await previewLeadImport(file);
      const initial: Record<string, string> = {};
      for (const header of response.headers) {
        initial[header] = response.mapping[header] ?? "";
      }
      setPreview(response);
      setMapping(initial);
    } catch (error) {
      setPreview(null);
      setErrorMessage(
        describeError(error, "پیش‌نمایش فایل ناموفق بود. لطفاً دوباره تلاش کنید."),
      );
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleCommit() {
    if (!preview) return;
    setIsCommitting(true);
    setErrorMessage(null);
    try {
      const response = await commitLeadImport({
        uploadId: preview.uploadId,
        mapping,
      });
      setResult(response);
      setPreview(null);
      setFile(null);
    } catch (error) {
      setErrorMessage(
        describeError(error, "ورود اطلاعات ناموفق بود. لطفاً دوباره تلاش کنید."),
      );
    } finally {
      setIsCommitting(false);
    }
  }

  return (
    <EnterpriseRouteGuard>
      <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
          <div className="flex flex-col gap-1">
            <Link
              href="/crm"
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowRight className="size-3.5" />
              بازگشت به مدیریت مشتریان
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <FileSpreadsheet className="size-6 text-indigo-500" />
              ورود اطلاعات از نرم‌افزار دیگر
            </h1>
            <p className="text-sm text-muted-foreground">
              فایل خروجی نرم‌افزار قبلی (CRM/حسابداری/ERP) را بارگذاری کنید؛
              ستون‌ها به‌صورت خودکار به فیلدهای سرنخ نگاشت می‌شوند و پیش از ورود
              قابل بازبینی و ویرایش هستند.
            </p>
          </div>

          {errorMessage && (
            <Alert variant="destructive">
              <AlertTitle>خطا در ورود اطلاعات</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          {result && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-emerald-500">
                  <CheckCircle2 className="size-4" />
                  نتیجه ورود اطلاعات
                </CardTitle>
                <CardDescription>
                  {result.imported} سرنخ درج شد و {result.skipped} ردیف تکراری
                  نادیده گرفته شد.
                </CardDescription>
              </CardHeader>
              {result.errors.length > 0 && (
                <CardContent className="flex flex-col gap-3">
                  <p className="text-sm font-medium text-rose-400">
                    {result.errors.length} ردیف به دلیل خطای اعتبارسنجی وارد نشد:
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">ردیف</TableHead>
                        <TableHead>دلیل</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.errors.map((error) => (
                        <TableRow key={`${error.row}-${error.reason}`}>
                          <TableCell>{error.row}</TableCell>
                          <TableCell className="whitespace-normal text-muted-foreground">
                            {error.reason}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="size-4 text-indigo-500" />
                بارگذاری فایل
              </CardTitle>
              <CardDescription>
                فقط فایل CSV یا Excel (xlsx) تا ۵ مگابایت و حداکثر ۵۰۰۰ ردیف
                پشتیبانی می‌شود.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Input
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setPreview(null);
                  setResult(null);
                  setErrorMessage(null);
                }}
              />
              <Button
                type="button"
                onClick={handlePreview}
                disabled={!file || isPreviewing}
                className="self-start"
              >
                {isPreviewing ? (
                  <>
                    <Loader2 className="animate-spin" />
                    در حال تحلیل فایل...
                  </>
                ) : (
                  <>
                    <Wand2 />
                    پیش‌نمایش و نگاشت خودکار
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {preview && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>نگاشت ستون‌ها</CardTitle>
                  <CardDescription>
                    {preview.mappingSource === "llm"
                      ? "نگاشت پیشنهادی با هوش مصنوعی (قابل ویرایش)."
                      : "نگاشت قطعی بر پایه نام‌های مشابه (هوش مصنوعی در دسترس نبود)."}{" "}
                    {mappedCount} ستون نگاشت شده است.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {preview.headers.map((header) => (
                    <div
                      key={header}
                      className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2"
                    >
                      <span className="truncate text-sm font-medium" title={header}>
                        {header || "(بدون عنوان)"}
                      </span>
                      <select
                        className={SELECT_CLASS}
                        value={mapping[header] ?? ""}
                        onChange={(event) =>
                          setMapping((current) => ({
                            ...current,
                            [header]: event.target.value,
                          }))
                        }
                      >
                        <option value="">نادیده گرفتن این ستون</option>
                        {LEAD_IMPORT_FIELD_ORDER.map((field) => (
                          <option key={field} value={field}>
                            {LEAD_IMPORT_FIELD_LABELS[field]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <Button
                    type="button"
                    onClick={handleCommit}
                    disabled={isCommitting}
                    className="self-start"
                  >
                    {isCommitting ? (
                      <>
                        <Loader2 className="animate-spin" />
                        در حال ورود...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 />
                        تأیید و ورود {preview.totalRows} ردیف
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>نمونه داده (۵ ردیف اول)</CardTitle>
                  <CardDescription>
                    پیش‌نمایش برای اطمینان از درستی نگاشت ستون‌ها.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {preview.headers.map((header) => (
                          <TableHead key={header}>{header}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.sampleRows.map((row, rowIndex) => (
                        <TableRow key={rowIndex}>
                          {row.map((cell, cellIndex) => (
                            <TableCell key={cellIndex}>{cell}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </main>
        <RoxiraFooter />
      </div>
    </EnterpriseRouteGuard>
  );
}
