"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BookOpen, Download } from "lucide-react";

import {
  ErrorNotice,
  LoadingLine,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  downloadElectronicBooks,
  type ElectronicBooksPresetItem,
  type ElectronicBooksPresetsResponse,
  type ElectronicBooksPreviewResponse,
  type ElectronicBooksUnit,
  type ElectronicBooksVoucherScope,
  getElectronicBooksPresets,
  getElectronicBooksPreview,
} from "@/lib/api/electronic-books-client";
import { formatNumber } from "@/lib/fa-format";

const YEARS = [1403, 1404, 1405, 1406];

const VOUCHER_SCOPE_LABELS: Record<ElectronicBooksVoucherScope, string> = {
  operational: "اسناد عملیاتی دوره",
  opening: "سند افتتاحیه (فایل جداگانه)",
  closing_temp: "اسناد بستن حساب‌های موقت (فایل جداگانه)",
  closing_perm: "اسناد اختتامیه حساب‌های دائم (فایل جداگانه)",
};

export default function ElectronicBooksPage() {
  const [year, setYear] = useState(1405);
  const [presetsData, setPresetsData] = useState<ElectronicBooksPresetsResponse | null>(null);
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>("FULL_YEAR");
  const [unit, setUnit] = useState<ElectronicBooksUnit>("million_rial");
  const [voucherScope, setVoucherScope] = useState<ElectronicBooksVoucherScope>("operational");
  const [monthlyAggregate, setMonthlyAggregate] = useState(false);
  const [preview, setPreview] = useState<ElectronicBooksPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPreset: ElectronicBooksPresetItem | undefined =
    selectedPresetKey === "FULL_YEAR"
      ? undefined
      : presetsData?.presets.find((p) => p.key === selectedPresetKey);

  const buildParams = useCallback(
    () => ({
      year,
      quarter: selectedPreset?.quarter,
      month: selectedPreset?.month,
      half: selectedPreset?.half,
      unit,
      voucherScope,
      monthlyAggregate,
    }),
    [year, selectedPreset, unit, voucherScope, monthlyAggregate],
  );

  const fetchPreviewData = useCallback(
    async (signal?: AbortSignal) => {
      const loadedPresets = await getElectronicBooksPresets(year, signal);
      const matchingPreset = loadedPresets.presets.find((p) => p.key === selectedPresetKey);
      const loadedPreview = await getElectronicBooksPreview(
        {
          year,
          quarter: matchingPreset?.quarter,
          month: matchingPreset?.month,
          half: matchingPreset?.half,
          unit,
          voucherScope,
          monthlyAggregate,
        },
        signal,
      );
      return { loadedPresets, loadedPreview };
    },
    [year, selectedPresetKey, unit, voucherScope, monthlyAggregate],
  );

  const refreshAll = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const { loadedPresets, loadedPreview } = await fetchPreviewData(signal);
        setPresetsData(loadedPresets);
        setPreview(loadedPreview);
      } catch (e) {
        if ((e as { name?: string })?.name !== "AbortError") {
          setError(loadErrorMessage(e));
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchPreviewData],
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    fetchPreviewData(controller.signal)
      .then(({ loadedPresets, loadedPreview }) => {
        if (cancelled) return;
        setPresetsData(loadedPresets);
        setPreview(loadedPreview);
        setError(null);
      })
      .catch((e) => {
        if (cancelled || (e as { name?: string })?.name === "AbortError") return;
        setError(loadErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fetchPreviewData]);

  const handleDownload = async (ext?: "xlsx" | "csv") => {
    setDownloading(true);
    setError(null);
    try {
      const targetExt = ext ?? (preview?.recommendedFormat === "csv" ? "csv" : "xlsx");
      await downloadElectronicBooks({ ...buildParams(), format: targetExt }, ext);
      await refreshAll();
    } catch (e) {
      setError(loadErrorMessage(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <EnterpriseRouteGuard>
      <div className="space-y-6 p-6" dir="rtl">
        <PageHeader
          title="دفاتر تجاری الکترونیکی"
          description="خروجی دفاتر روزنامه و کل منطبق با قالب نمونه سازمان امور مالیاتی (وضعیت تأیید درگاه: unverified) با تبدیل اعشار دقیق و کنترل تکرار دوره."
        />

        <ErrorNotice title="خطا در بارگذاری دفاتر تجاری" message={error} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4" />
              تنظیمات دوره، واحد و دامنه اسناد
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  سال مالی (شمسی)
                </label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={year}
                  onChange={(e) => {
                    setYear(Number(e.target.value));
                    setSelectedPresetKey("FULL_YEAR");
                  }}
                >
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {formatNumber(y)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  واحد مبلغ
                </label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as ElectronicBooksUnit)}
                >
                  <option value="million_rial">میلیون ریال (اعشار دقیق — در انتظار تأیید درگاه)</option>
                  <option value="rial">ریال</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  دامنه اسناد (فایل جداگانه)
                </label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={voucherScope}
                  onChange={(e) => setVoucherScope(e.target.value as ElectronicBooksVoucherScope)}
                >
                  {(Object.keys(VOUCHER_SCOPE_LABELS) as ElectronicBooksVoucherScope[]).map(
                    (scope) => (
                      <option key={scope} value={scope}>
                        {VOUCHER_SCOPE_LABELS[scope]}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  دوره‌های پیش‌فرض بر اساس تناوب {presetsData ? formatNumber(presetsData.periodicityMonths) : "۳"} ماهه:
                </span>
                {presetsData?.lastExportedEndDate && (
                  <span>آخرین تاریخ خروجی گرفته‌شده: {presetsData.lastExportedEndDate}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={selectedPresetKey === "FULL_YEAR" ? "default" : "outline"}
                  onClick={() => setSelectedPresetKey("FULL_YEAR")}
                >
                  کل سال {formatNumber(year)}
                </Button>
                {presetsData?.presets.map((preset) => (
                  <Button
                    key={preset.key}
                    type="button"
                    size="sm"
                    variant={selectedPresetKey === preset.key ? "default" : "outline"}
                    onClick={() => setSelectedPresetKey(preset.key)}
                    className="gap-2"
                  >
                    <span>{preset.label}</span>
                    {preset.alreadyExported && (
                      <Badge variant="secondary" className="text-[10px]">
                        خروجی گرفته‌شده
                      </Badge>
                    )}
                  </Button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={monthlyAggregate}
                onChange={(e) => setMonthlyAggregate(e.target.checked)}
              />
              <span>تجمیع ماهانه در سطح حساب معین (با تاریخ آخرین روز هر ماه شمسی)</span>
            </label>
          </CardContent>
        </Card>

        <LoadingLine show={loading} />
        {!loading && (
          preview && (
            <>
              {(preview.alreadyExported || preview.warnings.length > 0) && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>هشدار پیش از دریافت فایل دفاتر تجاری</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pr-4 text-sm">
                      {preview.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">
                      پیش‌نمایش خروجی ({preview.bounds.label} — {formatNumber(preview.rowCount)} ردیف)
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      قالب پیشنهادی خودکار: {preview.recommendedFormat.toUpperCase()} (تا ۱٬۰۰۰ ردیف
                      اکسل XLSX و بیشتر از آن CSV UTF-8) • اختلاف گرد کردن:{" "}
                      {preview.roundingDifference}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void handleDownload()}
                      disabled={downloading}
                      className="gap-2"
                    >
                      <Download className="h-4 w-4" />
                      دانلود خودکار ({preview.recommendedFormat.toUpperCase()})
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void handleDownload("xlsx")}
                      disabled={downloading}
                    >
                      XLSX
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void handleDownload("csv")}
                      disabled={downloading}
                    >
                      CSV
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {preview.headers.map((h) => (
                            <TableHead key={h} className="whitespace-nowrap text-right">
                              {h}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.sampleRows.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={preview.headers.length}
                              className="text-center text-sm text-muted-foreground"
                            >
                              ردیفی در این دوره و دامنه اسناد یافت نشد.
                            </TableCell>
                          </TableRow>
                        ) : (
                          preview.sampleRows.map((row, idx) => (
                            <TableRow key={idx}>
                              {row.map((cell, cIdx) => (
                                <TableCell key={cIdx} className="whitespace-nowrap">
                                  {String(cell)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )
        )}
      </div>
    </EnterpriseRouteGuard>
  );
}
