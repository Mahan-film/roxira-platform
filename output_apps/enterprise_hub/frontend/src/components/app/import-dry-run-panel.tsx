"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  FileJson,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError } from "@/lib/api/http-client";
import { runTransactionalImportDryRun } from "@/lib/api/import-dry-run-client";
import { formatAmount, formatNumber } from "@/lib/fa-format";
import {
  duplicateReasonLabel,
  parseDryRunJsonPayload,
  sourceDisplayLabel,
  summarizeDryRunGate,
  unmappedReasonLabel,
  type ImportDryRunEntityCount,
  type ImportDryRunReport,
  type ImportDryRunSource,
} from "@/lib/import-dry-run-helpers";

const SAMPLE_PLACEHOLDER = `{
  "openingDate": "2026-03-21",
  "accounts": [],
  "parties": [],
  "items": [],
  "openingVoucher": [],
  "cheques": []
}`;

function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger" | "warn";
}) {
  const valueClass =
    tone === "success"
      ? "text-emerald-400"
      : tone === "danger"
        ? "text-rose-400"
        : tone === "warn"
          ? "text-amber-300"
          : "";
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-bold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}

function EntityCountCard({
  title,
  counts,
  extraLabel,
}: {
  title: string;
  counts: ImportDryRunEntityCount;
  extraLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-3 text-xs">
      <p className="font-bold text-foreground">{title}</p>
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
        <span>ورودی: {formatNumber(counts.incoming)}</span>
        <span className="text-emerald-400">درج آزمایشی: {formatNumber(counts.wouldInsert)}</span>
        <span>تکراری/موجود: {formatNumber(counts.existingSkipped)}</span>
        <span className={counts.invalidCount > 0 ? "text-rose-400" : ""}>
          نامعتبر: {formatNumber(counts.invalidCount)}
        </span>
      </div>
      {extraLabel && <p className="mt-1.5 text-[11px] text-amber-300">{extraLabel}</p>}
    </div>
  );
}

/**
 * پنل اجرای آزمایشی (Dry-Run) انتقال از سپیدار و هلو در تراکنش دیتابیس همراه با Rollback کامل.
 */
export function ImportDryRunPanel() {
  const [source, setSource] = useState<ImportDryRunSource>("sepidar");
  const [rawJson, setRawJson] = useState<string>("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportDryRunReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFilePicked(file: File | undefined) {
    if (!file) return;
    setError(null);
    setFileName(file.name);
    const content = await file.text();
    setRawJson(content);
  }

  async function executeDryRun(payload: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const result = await runTransactionalImportDryRun(source, payload);
      setReport(result);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError("اجرای آزمایشی انتقال با خطا مواجه شد.");
      }
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  function handleRunFromJson() {
    const parsed = parseDryRunJsonPayload(rawJson);
    if (!parsed.ok) {
      setError(parsed.errorFa);
      return;
    }
    void executeDryRun(parsed.payload);
  }

  function handleRunSynthetic() {
    void executeDryRun({ useSynthetic: true });
  }

  const gate = report ? summarizeDryRunGate(report) : null;

  return (
    <Card className="mt-8 border-indigo-500/30">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <DatabaseZap className="size-5 text-indigo-400" aria-hidden="true" />
          اجرای آزمایشی انتقال {sourceDisplayLabel(source)} (Dry-Run با Rollback)
          <Badge variant="secondary" className="gap-1">
            <RotateCcw className="size-3" aria-hidden="true" />
            بدون ثبت در دیتابیس
          </Badge>
        </CardTitle>
        <CardDescription>
          کل انتقال (کدینگ، اشخاص، کالاها، سند افتتاحیه و چک‌های باز) درون یک تراکنش واقعی PostgreSQL اجرا و سپس
          به‌طور کامل بازگردانی (Rollback) می‌شود تا پیش از ثبت نهایی، مغایرت‌ها و سرجمع‌ها را ببینید.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2" role="group" aria-label="انتخاب نرم‌افزار مبدا">
            <Button
              type="button"
              size="sm"
              variant={source === "sepidar" ? "default" : "outline"}
              onClick={() => {
                setSource("sepidar");
                setReport(null);
                setError(null);
              }}
              disabled={loading}
            >
              سپیدار (Sepidar)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={source === "holoo" ? "default" : "outline"}
              onClick={() => {
                setSource("holoo");
                setReport(null);
                setError(null);
              }}
              disabled={loading}
            >
              هلو (Holoo)
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => void handleFilePicked(e.target.files?.[0])}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              <Upload className="ml-1.5 size-3.5" aria-hidden="true" />
              {fileName ? `فایل: ${fileName}` : "بارگذاری فایل JSON"}
            </Button>
            {process.env.NODE_ENV !== "production" && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleRunSynthetic}
                disabled={loading}
                title="فقط در محیط توسعه/آزمایش با داده‌های آزمایشی استاندارد کار می‌کند"
              >
                <FileJson className="ml-1.5 size-3.5" aria-hidden="true" />
                اجرا با دادهٔ آزمایشی استاندارد (محیط آزمایشی)
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="dry-run-json-input" className="text-xs font-medium text-muted-foreground">
            محتوای JSON ساختاریافتهٔ انتقال از {sourceDisplayLabel(source)} (حداکثر ۲۰۰ ردیف در هر بخش برای هر دسته؛ فیلدهای اضافه مجاز نیست):
          </label>
          <textarea
            id="dry-run-json-input"
            dir="ltr"
            rows={6}
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            placeholder={SAMPLE_PLACEHOLDER}
            className="w-full rounded-xl border border-border/70 bg-background/70 p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={handleRunFromJson} disabled={loading}>
              {loading ? "در حال اجرای تراکنش آزمایشی..." : "اجرای آزمایشی (Dry-Run)"}
            </Button>
            {report && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setReport(null);
                  setError(null);
                }}
              >
                پاک کردن گزارش
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {report && gate && (
          <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {gate.canProceedToCommit ? (
                  <CheckCircle2 className="size-5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <ShieldAlert className="size-5 text-rose-400" aria-hidden="true" />
                )}
                <p className="text-sm font-bold">{gate.headlineFa}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-indigo-500/15 text-indigo-300">
                  تراکنش بازگردانی شد (Rollback = {report.rolledBack ? "بله" : "خیر"})
                </Badge>
                <Badge
                  className={
                    report.openingTrialBalance.balanced
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-rose-500/15 text-rose-300"
                  }
                >
                  {report.openingTrialBalance.balanced ? "تراز افتتاحیه متوازن" : "عدم‌تراز افتتاحیه"}
                </Badge>
              </div>
            </div>

            {report.blockersFa.length > 0 && (
              <div className="flex flex-col gap-1 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
                <p className="font-bold">خطاهای مسدودکننده پیش از ثبت نهایی:</p>
                {report.blockersFa.map((msg) => (
                  <p key={msg}>• {msg}</p>
                ))}
              </div>
            )}

            {report.warningsFa.length > 0 && (
              <div className="flex flex-col gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                <p className="flex items-center gap-1 font-bold">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  هشدارها:
                </p>
                {report.warningsFa.map((msg) => (
                  <p key={msg}>• {msg}</p>
                ))}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <EntityCountCard title="کدینگ حساب‌ها" counts={report.counts.accounts} />
              <EntityCountCard
                title="اشخاص و طرف‌حساب‌ها"
                counts={report.counts.parties}
                extraLabel={
                  report.counts.parties.duplicates > 0
                    ? `${formatNumber(report.counts.parties.duplicates)} مورد تکراری/تداخلی`
                    : undefined
                }
              />
              <EntityCountCard title="کالاها و خدمات" counts={report.counts.items} />
              <EntityCountCard
                title="اقلام سند افتتاحیه"
                counts={report.counts.openingLines}
                extraLabel={
                  report.counts.openingLines.unmapped > 0
                    ? `${formatNumber(report.counts.openingLines.unmapped)} ردیف بی‌نگاشت`
                    : undefined
                }
              />
              <EntityCountCard
                title="چک‌های باز"
                counts={report.counts.cheques}
                extraLabel={
                  report.counts.cheques.closedSkipped > 0
                    ? `${formatNumber(report.counts.cheques.closedSkipped)} چک بسته رد شد`
                    : undefined
                }
              />
            </div>

            <div className="rounded-xl border border-border/60 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-bold">
                  <ShieldCheck className="size-4 text-emerald-400" aria-hidden="true" />
                  جمع تراز افتتاحیه ({formatNumber(report.openingTrialBalance.lineCount)} ردیف)
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  تایید درج درون تراکنش: {report.openingTrialBalance.persistedInTx ? "بله" : "خیر (دارای مغایرت)"}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <StatTile
                  label="جمع بدهکار"
                  value={formatAmount(report.openingTrialBalance.totalDebitRial, "rial")}
                />
                <StatTile
                  label="جمع بستانکار"
                  value={formatAmount(report.openingTrialBalance.totalCreditRial, "rial")}
                />
                <StatTile
                  label="اختلاف تراز"
                  value={formatAmount(report.openingTrialBalance.varianceRial, "rial")}
                  tone={report.openingTrialBalance.balanced ? "success" : "danger"}
                />
              </div>

              {report.openingTrialBalance.accounts.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="border-b border-border/60 text-muted-foreground">
                      <tr>
                        <th className="py-1.5 pl-3">کد حساب</th>
                        <th className="py-1.5 pl-3">عنوان حساب</th>
                        <th className="py-1.5 pl-3">وضعیت نگاشت</th>
                        <th className="py-1.5 pl-3">بدهکار</th>
                        <th className="py-1.5">بستانکار</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.openingTrialBalance.accounts.map((row) => (
                        <tr key={row.accountCode} className="border-b border-border/40 last:border-0">
                          <td className="py-1.5 pl-3 font-mono">{row.accountCode}</td>
                          <td className="py-1.5 pl-3">{row.accountName ?? "—"}</td>
                          <td className="py-1.5 pl-3">
                            <span className={row.mapped ? "text-emerald-400" : "text-rose-400"}>
                              {row.mapped ? "نگاشت‌شده" : "بی‌نگاشت"}
                            </span>
                          </td>
                          <td className="py-1.5 pl-3 tabular-nums">
                            {formatAmount(row.debitRial, "rial")}
                          </td>
                          <td className="py-1.5 tabular-nums">{formatAmount(row.creditRial, "rial")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-border/60 p-3 text-xs">
                <h3 className="mb-2 font-bold">
                  حساب‌های بدون نگاشت ({formatNumber(report.unmappedAccounts.length)})
                </h3>
                {report.unmappedAccounts.length === 0 ? (
                  <p className="text-muted-foreground">همهٔ حساب‌های سند افتتاحیه معتبر و نگاشت‌شده هستند.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {report.unmappedAccounts.map((acc) => (
                      <li
                        key={`${acc.accountCode}-${acc.reason}`}
                        className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2"
                      >
                        <p className="font-mono font-bold text-rose-300">
                          {acc.accountCode} — {unmappedReasonLabel(acc.reason)}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          {formatNumber(acc.lineCount)} ردیف · بدهکار{" "}
                          {formatAmount(acc.debitRial, "rial")} · بستانکار{" "}
                          {formatAmount(acc.creditRial, "rial")}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-border/60 p-3 text-xs">
                <h3 className="mb-2 font-bold">
                  اشخاص تکراری یا متداخل ({formatNumber(report.duplicateParties.length)})
                </h3>
                {report.duplicateParties.length === 0 ? (
                  <p className="text-muted-foreground">هیچ شخص تکراری در فایل یا دیتابیس یافت نشد.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {report.duplicateParties.map((dup) => (
                      <li
                        key={`${dup.code}-${dup.reason}-${dup.conflictingCode ?? ""}`}
                        className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2"
                      >
                        <p className="font-bold text-amber-200">
                          {dup.name} ({dup.code})
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          {duplicateReasonLabel(dup.reason)}
                          {dup.nationalId ? ` · شناسه/کدملی: ${dup.nationalId}` : ""}
                          {dup.conflictingCode ? ` · کد متناظر: ${dup.conflictingCode}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border/60 p-3 text-xs">
              <h3 className="mb-2 font-bold">
                خلاصهٔ چک‌های باز ({formatNumber(report.openCheques.totalCount)} فقره)
              </h3>
              <div className="grid gap-2 sm:grid-cols-4">
                <StatTile
                  label="جمع کل چک‌های باز"
                  value={formatAmount(report.openCheques.totalAmountRial, "rial")}
                />
                <StatTile
                  label={`دریافتنی (${formatNumber(report.openCheques.receivedCount)})`}
                  value={formatAmount(report.openCheques.receivedAmountRial, "rial")}
                />
                <StatTile
                  label={`پرداختنی (${formatNumber(report.openCheques.issuedCount)})`}
                  value={formatAmount(report.openCheques.issuedAmountRial, "rial")}
                />
                <StatTile
                  label={`واگذارشده به غیر (${formatNumber(report.openCheques.endorsedCount)})`}
                  value={formatAmount(report.openCheques.endorsedAmountRial, "rial")}
                />
              </div>
              {report.openCheques.invalidErrors.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-rose-300">
                  {report.openCheques.invalidErrors.map((err) => (
                    <li key={`${err.chequeNumber}-${err.reason}`}>
                      • چک {err.chequeNumber}: {err.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
