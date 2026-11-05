"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  FileUp,
  Loader2,
  Undo2,
  TriangleAlert,
} from "lucide-react";

import { ErrorNotice } from "@/components/app/app-ui";
import { useImportHandoff, type ImportTab } from "@/components/app/import-handoff";
import { PackageImportWizard } from "@/components/app/package-import-wizard";
import { useImportLimits } from "@/components/app/use-import-accept";
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
  commitImport,
  importErrorMessage,
  listImportBatches,
  listImportEntities,
  previewImport,
  undoImportBatch,
  validateImportFile,
  type ImportBatch,
  type ImportCommitResult,
  type ImportEntityDef,
  type ImportPreview,
  type ImportSampleRow,
} from "@/lib/api/data-import-suite-client";
import { listBankAccounts } from "@/lib/api/banking-client";
import { formatJalaliDateTime, formatNumber } from "@/lib/fa-format";
import { routeImportFile } from "@/lib/import-routing";
import { cn } from "@/lib/utils";
import { BANK_LABELS, type BankAccount } from "@/types/banking";

type Step = "upload" | "review" | "done";

/** Registry key of the bank statement entity; it needs a target bank account on commit. */
const BANK_STATEMENT_ENTITY = "bank-statement";

const STEP_LABELS: Array<[Step, string]> = [
  ["upload", "۱. بارگذاری فایل"],
  ["review", "۲. بررسی و نگاشت ستون‌ها"],
  ["done", "۳. نتیجه ورود"],
];

/** Where to send the user after a successful import (entity keys come from the backend registry). */
function entityRoute(entity: string): string | null {
  const key = entity.toLowerCase();
  if (key === BANK_STATEMENT_ENTITY) return "/app/accounting/bank";
  if (/lead|customer|contact|crm/.test(key)) return "/app/crm";
  if (/employee|staff|hr/.test(key)) return "/app/hr";
  if (/item|product|stock|inventory|warehouse/.test(key)) return "/app/inventory";
  if (/account|journal|ledger|balance/.test(key)) return "/app/accounting";
  return null;
}

function sampleCell(row: ImportSampleRow, header: string, index: number): string {
  const value = Array.isArray(row)
    ? row[index]
    : (row as Record<string, unknown>)[header];
  return value === null || value === undefined ? "" : String(value);
}

type ImportMode = ImportTab;

const MODE_LABELS: Array<[ImportMode, string]> = [
  ["file", "ورود فایل (اکسل، CSV، PDF)"],
  ["package", "انتقال کامل دیتابیس"],
];

/**
 * `onBulkFile` receives files over 5 MB: production nginx caps one request at 16 MB and the
 * package import at 40 MB, so those go to the bulk streaming import above the wizard (#277).
 */
export function ImportWizard({ onBulkFile }: { onBulkFile?: (file: File) => void } = {}) {
  const { pendingFile, pendingTab, setPendingFile, setPendingTab } = useImportHandoff();
  const [mode, setMode] = useState<ImportMode>("file");
  const [handoff, setHandoff] = useState<File | null>(null);
  const { bulkEnabled } = useImportLimits();

  // A file dropped anywhere in /app (or a palette command) is handed over here.
  useEffect(() => {
    if (!pendingFile && !pendingTab) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (pendingFile) {
      const route = routeImportFile(pendingFile, bulkEnabled);
      if (route === "bulk" && onBulkFile) {
        onBulkFile(pendingFile);
      } else {
        setHandoff(pendingFile);
        setMode(route === "single" ? "file" : "package");
      }
    } else if (pendingTab) {
      setMode(pendingTab);
    }
    setPendingFile(null);
    setPendingTab(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pendingFile, pendingTab, setPendingFile, setPendingTab, bulkEnabled, onBulkFile]);

  function openPackage(file: File) {
    setHandoff(file);
    setMode("package");
  }

  function selectMode(next: ImportMode) {
    setHandoff(null);
    setMode(next);
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="نوع ورود داده"
        className="flex flex-wrap gap-2 rounded-2xl bg-muted/40 p-1"
      >
        {MODE_LABELS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => selectMode(key)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
              mode === key
                ? "bg-background font-bold text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "file" ? (
        <SingleFileImportWizard
          initialFile={handoff}
          onInitialFileUsed={() => setHandoff(null)}
          onPackageFile={openPackage}
          onBulkFile={onBulkFile}
        />
      ) : (
        <PackageImportWizard
          initialFile={handoff}
          onInitialFileUsed={() => setHandoff(null)}
          onBulkFile={onBulkFile}
        />
      )}
    </div>
  );
}

function SingleFileImportWizard({
  initialFile = null,
  onInitialFileUsed,
  onPackageFile,
  onBulkFile,
}: {
  initialFile?: File | null;
  onInitialFileUsed?: () => void;
  onPackageFile: (file: File) => void;
  onBulkFile?: (file: File) => void;
}) {
  const { accept, bulkEnabled } = useImportLimits();
  const [step, setStep] = useState<Step>("upload");
  const [entities, setEntities] = useState<ImportEntityDef[]>([]);
  const [entitiesError, setEntitiesError] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [entity, setEntity] = useState("");
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [undoConfirm, setUndoConfirm] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[] | null>(null);
  const [bankAccountId, setBankAccountId] = useState<number | null>(null);

  const loadBatches = useCallback((signal?: AbortSignal) => {
    listImportBatches(signal)
      .then((list) => {
        setBatches(list);
        setBatchesError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setBatchesError(importErrorMessage(err));
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    listImportEntities(controller.signal)
      .then(setEntities)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setEntitiesError(true);
      });
    loadBatches(controller.signal);
    return () => controller.abort();
  }, [loadBatches]);

  const isBankStatement = entity === BANK_STATEMENT_ENTITY;

  // Bank statements go into one of the tenant's bank accounts; load them once when needed.
  useEffect(() => {
    if (!isBankStatement || bankAccounts !== null) return;
    const controller = new AbortController();
    listBankAccounts(controller.signal)
      .then((accounts) => {
        setBankAccounts(accounts);
        setBankAccountId((current) => current ?? accounts[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setBankAccounts([]);
      });
    return () => controller.abort();
  }, [isBankStatement, bankAccounts]);

  const entityDef = useMemo(
    () => entities.find((e) => e.key === entity) ?? null,
    [entities, entity],
  );
  const entityLabel = useCallback(
    (key: string) => entities.find((e) => e.key === key)?.labelFa ?? key,
    [entities],
  );

  async function runPreview(target: File, chosenEntity?: string) {
    const invalid = validateImportFile(target);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await previewImport(target, chosenEntity);
      setFile(target);
      setPreview(data);
      setEntity(data.detectedEntity);
      setMapping(data.mapping);
      setStep("review");
    } catch (err) {
      setError(importErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleFiles(files: FileList | null) {
    const first = files?.[0];
    if (!first) return;
    // Only small spreadsheets, PDFs and images fit one request; the rest go up in chunks.
    const route = routeImportFile(first, bulkEnabled);
    if (route === "bulk" && onBulkFile) {
      onBulkFile(first);
      return;
    }
    if (route !== "single") {
      onPackageFile(first);
      return;
    }
    void runPreview(first);
  }

  function changeEntity(next: string) {
    setEntity(next);
    // The server re-detects columns for the chosen entity.
    if (file) void runPreview(file, next);
  }

  // A file handed over by the drop-anywhere overlay or the command palette is previewed once.
  useEffect(() => {
    if (!initialFile) return;
    onInitialFileUsed?.();
    // One-shot start for a file handed over by the parent (an external event, not derived state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runPreview(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const missingRequired = useMemo(() => {
    if (!entityDef) return [] as string[];
    const mapped = new Set(Object.values(mapping).filter(Boolean) as string[]);
    return entityDef.fields
      .filter((f) => f.required && !mapped.has(f.key))
      .map((f) => f.labelFa);
  }, [entityDef, mapping]);

  const duplicateTargets = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const value of Object.values(mapping)) {
      if (!value) continue;
      if (seen.has(value)) dup.add(value);
      seen.add(value);
    }
    return dup;
  }, [mapping]);

  async function handleCommit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const data = await commitImport({
        uploadId: preview.uploadId,
        entity,
        mapping,
        bankAccountId: isBankStatement ? (bankAccountId ?? undefined) : undefined,
      });
      setResult(data);
      setStep("done");
      loadBatches();
    } catch (err) {
      setError(importErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setResult(null);
    setMapping({});
    setEntity("");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleUndo(batchId: string) {
    setUndoing(batchId);
    setUndoConfirm(null);
    try {
      await undoImportBatch(batchId);
      loadBatches();
    } catch (err) {
      setBatchesError(importErrorMessage(err));
    } finally {
      setUndoing(null);
    }
  }

  const canCommit =
    !busy &&
    missingRequired.length === 0 &&
    duplicateTargets.size === 0 &&
    Boolean(entity) &&
    (!isBankStatement || bankAccountId !== null);

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap gap-2 text-xs" aria-label="مراحل ورود داده">
        {STEP_LABELS.map(([key, label]) => (
          <li
            key={key}
            aria-current={step === key ? "step" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 ring-1",
              step === key
                ? "bg-indigo-500/15 font-bold text-indigo-300 ring-indigo-500/40"
                : "text-muted-foreground ring-border",
            )}
          >
            {label}
          </li>
        ))}
      </ol>

      <ErrorNotice title="ورود داده انجام نشد" message={error} />

      {step === "upload" && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-6 py-16 text-center transition-colors",
              dragging
                ? "border-indigo-400 bg-indigo-500/15"
                : "border-indigo-500/40 bg-indigo-500/5",
            )}
          >
            {busy ? (
              <Loader2 className="size-12 animate-spin text-indigo-400" aria-hidden="true" />
            ) : (
              <FileUp className="size-12 text-indigo-400" aria-hidden="true" />
            )}
            <p className="text-lg font-bold">
              {busy ? "در حال تحلیل فایل..." : "فایل خود را اینجا رها کنید"}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              اکسل، CSV، PDF یا عکس. سیستم نوع داده را
              تشخیص می‌دهد و ستون‌ها را خودکار جفت می‌کند؛ قبل از ثبت، همه چیز را می‌بینید.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="sr-only"
              id="import-file"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button
              size="lg"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              انتخاب فایل
            </Button>
            <span className="text-xs text-muted-foreground" dir="ltr">
              xlsx · csv · pdf · jpg · png
            </span>
          </div>
          {entitiesError && (
            <p className="flex items-center gap-1.5 text-xs text-amber-400">
              <TriangleAlert className="size-3.5" aria-hidden="true" />
              فهرست انواع داده بارگذاری نشد؛ ممکن است سرویس ورود داده هنوز فعال نباشد.
            </p>
          )}
        </>
      )}

      {step === "review" && preview && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                نوع داده تشخیص‌داده‌شده
                <Badge variant="secondary">
                  اطمینان {formatNumber(Math.round(preview.confidence * 100))}٪
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground">
                  {file?.name} — {formatNumber(preview.rowCount)} ردیف
                </span>
                <label className="flex items-center gap-2">
                  <span>نوع:</span>
                  <select
                    value={entity}
                    disabled={busy}
                    onChange={(e) => changeEntity(e.target.value)}
                    aria-label="نوع داده"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    {!entityDef && <option value={entity}>{entityLabel(entity)}</option>}
                    {entities.map((e) => (
                      <option key={e.key} value={e.key}>
                        {e.labelFa}
                      </option>
                    ))}
                  </select>
                </label>
                {isBankStatement && bankAccounts !== null && bankAccounts.length > 0 && (
                  <label className="flex items-center gap-2">
                    <span>حساب بانکی:</span>
                    <select
                      value={bankAccountId ?? ""}
                      disabled={busy}
                      onChange={(e) => setBankAccountId(Number(e.target.value))}
                      aria-label="حساب بانکی مقصد"
                      className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    >
                      {bankAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name} — {BANK_LABELS[account.bankCode]} — {account.accountNumber}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {isBankStatement && bankAccounts !== null && bankAccounts.length === 0 && (
                  <span className="text-amber-600">
                    حساب بانکی تعریف نشده است.{" "}
                    <Link href="/app/accounting/bank" className="underline">
                      تعریف حساب بانکی
                    </Link>
                  </span>
                )}
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>نگاشت ستون‌ها</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ستون فایل</TableHead>
                  <TableHead>نمونه</TableHead>
                  <TableHead>فیلد مقصد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.headers.map((header, index) => {
                  const target = mapping[header] ?? "";
                  const isDup = Boolean(target) && duplicateTargets.has(target);
                  return (
                    <TableRow key={`${header}-${index}`}>
                      <TableCell className="font-medium">{header}</TableCell>
                      <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                        {preview.sampleRows
                          .slice(0, 2)
                          .map((r) => sampleCell(r, header, index))
                          .filter(Boolean)
                          .join(" ، ")}
                      </TableCell>
                      <TableCell>
                        <select
                          value={target}
                          disabled={busy}
                          onChange={(e) =>
                            setMapping((m) => ({ ...m, [header]: e.target.value || null }))
                          }
                          aria-label={`فیلد مقصد برای ${header}`}
                          aria-invalid={isDup}
                          className={cn(
                            "h-8 w-full min-w-40 rounded-lg border bg-background px-2 text-sm",
                            isDup ? "border-rose-500" : "border-input",
                          )}
                        >
                          <option value="">— نادیده گرفتن —</option>
                          {(entityDef?.fields ?? []).map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.labelFa}
                              {f.required ? " *" : ""}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {(missingRequired.length > 0 || duplicateTargets.size > 0) && (
              <div className="flex flex-col gap-1 border-t border-border p-3 text-xs text-amber-400">
                {missingRequired.length > 0 && (
                  <span>فیلدهای الزامی بدون ستون: {missingRequired.join("، ")}</span>
                )}
                {duplicateTargets.size > 0 && (
                  <span>یک فیلد مقصد فقط می‌تواند به یک ستون وصل شود.</span>
                )}
              </div>
            )}
          </Card>

          {preview.sampleRows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>نمونه ردیف‌ها</CardTitle>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    {preview.headers.map((h, i) => (
                      <TableHead key={`${h}-${i}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.sampleRows.slice(0, 5).map((row, r) => (
                    <TableRow key={r}>
                      {preview.headers.map((h, i) => (
                        <TableCell key={`${h}-${i}`} className="text-xs">
                          {sampleCell(row, h, i)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {preview.errors.length > 0 && (
            <Card className="ring-1 ring-amber-500/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-400">
                  <TriangleAlert className="size-4" aria-hidden="true" />
                  {formatNumber(preview.errors.length)} خطا در ردیف‌ها
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-xs">
                  {preview.errors.slice(0, 100).map((e, i) => (
                    <li key={i}>
                      ردیف {formatNumber(e.row)}
                      {e.field ? ` (${e.field})` : ""}: {e.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  ردیف‌های دارای خطا هنگام ثبت رد می‌شوند؛ بقیه ردیف‌ها وارد می‌شوند.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-2">
            <Button disabled={!canCommit} onClick={handleCommit}>
              {busy ? "در حال ثبت..." : `تأیید و ثبت ${formatNumber(preview.rowCount)} ردیف`}
            </Button>
            <Button variant="outline" disabled={busy} onClick={reset}>
              انصراف
            </Button>
          </div>
        </>
      )}

      {step === "done" && result && (
        <Card className="ring-1 ring-emerald-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="size-5" aria-hidden="true" />
              ورود داده انجام شد
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-emerald-500/10 p-3">
                <div className="text-2xl font-bold">{formatNumber(result.inserted)}</div>
                <div className="text-xs text-muted-foreground">ثبت‌شده</div>
              </div>
              <div className="rounded-xl bg-amber-500/10 p-3">
                <div className="text-2xl font-bold">{formatNumber(result.skippedDuplicates)}</div>
                <div className="text-xs text-muted-foreground">تکراری (رد شد)</div>
              </div>
              <div className="rounded-xl bg-rose-500/10 p-3">
                <div className="text-2xl font-bold">{formatNumber(result.failed.length)}</div>
                <div className="text-xs text-muted-foreground">ناموفق</div>
              </div>
            </div>
            {result.failed.length > 0 && (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
                {result.failed.slice(0, 100).map((f, i) => (
                  <li key={i}>
                    ردیف {formatNumber(f.row)}: {f.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              {entityRoute(entity) && (
                <Link
                  href={entityRoute(entity) as string}
                  className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm text-primary-foreground"
                >
                  مشاهده داده‌های واردشده
                </Link>
              )}
              <Button variant="outline" onClick={reset}>
                ورود فایل دیگر
              </Button>
              <Button
                variant="destructive"
                disabled={undoing === result.batchId}
                onClick={() => void handleUndo(result.batchId).then(reset)}
              >
                <Undo2 />
                بازگردانی این ورود
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>ورودهای اخیر</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ErrorNotice title="خطا در دریافت سوابق ورود" message={batchesError} />
          {batches.length === 0 && !batchesError && (
            <p className="text-sm text-muted-foreground">هنوز داده‌ای وارد نشده است.</p>
          )}
          {batches.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>فایل</TableHead>
                  <TableHead>نوع</TableHead>
                  <TableHead>ثبت‌شده</TableHead>
                  <TableHead>تاریخ</TableHead>
                  <TableHead>
                    <span className="sr-only">عملیات</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.batchId}>
                    <TableCell className="max-w-48 truncate font-medium">{b.fileName}</TableCell>
                    <TableCell>{entityLabel(b.entity)}</TableCell>
                    <TableCell>{formatNumber(b.inserted)}</TableCell>
                    <TableCell>{formatJalaliDateTime(b.createdAt)}</TableCell>
                    <TableCell>
                      {b.undone ? (
                        <Badge variant="secondary">بازگردانی شد</Badge>
                      ) : undoConfirm === b.batchId ? (
                        <span className="flex items-center gap-1">
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={undoing === b.batchId}
                            onClick={() => void handleUndo(b.batchId)}
                          >
                            تأیید حذف
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setUndoConfirm(null)}>
                            انصراف
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={undoing === b.batchId}
                          onClick={() => setUndoConfirm(b.batchId)}
                        >
                          <Undo2 />
                          بازگردانی
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
