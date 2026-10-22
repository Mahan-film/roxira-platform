"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Coins,
  Database,
  FileArchive,
  Link2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  XCircle,
} from "lucide-react";

import { ErrorNotice } from "@/components/app/app-ui";
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
  PACKAGE_ACCEPT,
  PACKAGE_ENTITY_LABELS,
  PACKAGE_MAX_BYTES,
  commitImportPackage,
  createImportPackage,
  getImportPackage,
  getImportPackageProgress,
  importErrorMessage,
  listImportBatches,
  listImportEntities,
  packageEntityLabel,
  undoImportBatch,
  validatePackageFile,
  type ImportBatch,
  type ImportPackageCommitTable,
  type ImportEntityDef,
  type ImportPackageDetail,
  type ImportPackageProgress,
} from "@/lib/api/data-import-suite-client";
import { formatJalaliDateTime, formatNumber } from "@/lib/fa-format";
import { cn } from "@/lib/utils";

type PackagePhase = "upload" | "analyzing" | "review" | "committing" | "done";

const PHASE_LABELS: Array<[PackagePhase, string]> = [
  ["upload", "۱. بارگذاری بسته"],
  ["analyzing", "۲. تحلیل دیتابیس"],
  ["review", "۳. بررسی و نگاشت"],
  ["committing", "۴. انتقال داده‌ها"],
  ["done", "۵. نتیجه انتقال"],
];

function healthIcon(level: "ok" | "warn" | "error") {
  if (level === "ok") return <ShieldCheck className="size-4 text-emerald-400" aria-hidden="true" />;
  if (level === "warn") return <TriangleAlert className="size-4 text-amber-400" aria-hidden="true" />;
  return <XCircle className="size-4 text-rose-400" aria-hidden="true" />;
}

function healthTone(level: "ok" | "warn" | "error"): string {
  if (level === "ok") return "ring-emerald-500/30 bg-emerald-500/5";
  if (level === "warn") return "ring-amber-500/30 bg-amber-500/5";
  return "ring-rose-500/30 bg-rose-500/5";
}

export function PackageImportWizard({
  initialFile = null,
  onInitialFileUsed,
}: {
  initialFile?: File | null;
  onInitialFileUsed?: () => void;
} = {}) {
  const [phase, setPhase] = useState<PackagePhase>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ImportPackageDetail | null>(null);
  const [progress, setProgress] = useState<ImportPackageProgress | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [tables, setTables] = useState<ImportPackageCommitTable[]>([]);
  const [entities, setEntities] = useState<ImportEntityDef[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [warnConfirmed, setWarnConfirmed] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [undoConfirm, setUndoConfirm] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);

  const entityDefByKey = useMemo(
    () => new Map(entities.map((e) => [e.key, e])),
    [entities],
  );

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
      .catch(() => {
        /* نگاشت به فهرست پشتیبان برمی‌گردد */
      });
    loadBatches(controller.signal);
    return () => controller.abort();
  }, [loadBatches]);

  useEffect(() => {
    if (phase !== "analyzing" || !packageId) return;
    const id = packageId;
    let cancelled = false;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const data = await getImportPackage(id, controller.signal);
        if (cancelled) return;
        setDetail(data);
        if (data.status === "ready") {
          setTables(
            data.tables.map((t) => ({
              name: t.name,
              entity: t.detectedEntity ?? "",
              mapping: t.mapping,
              skip: t.skipped ?? t.detectedEntity === null,
            })),
          );
          setPhase("review");
        } else if (data.status === "failed") {
          setError(data.error ?? "تحلیل بسته ناموفق بود.");
          setPhase("upload");
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(importErrorMessage(err));
        setPhase("upload");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [phase, packageId]);

  useEffect(() => {
    if (phase !== "committing" || !packageId) return;
    const id = packageId;
    let cancelled = false;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const [data, prog] = await Promise.all([
          getImportPackage(id, controller.signal),
          getImportPackageProgress(id, controller.signal),
        ]);
        if (cancelled) return;
        setDetail(data);
        setProgress(prog);
        if (data.status === "committed") {
          setPhase("done");
          // The commit recorded an undo batch: show it under «ورودهای اخیر».
          loadBatches();
        } else if (data.status === "failed") {
          setError(data.error ?? "ثبت بسته ناموفق بود.");
          setPhase("review");
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(importErrorMessage(err));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [phase, packageId, loadBatches]);

  async function runUpload(target: File) {
    const invalid = validatePackageFile(target);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    setUploadPercent(0);
    setFile(target);
    try {
      const created = await createImportPackage(target, {
        onProgress: setUploadPercent,
      });
      setPackageId(created.packageId);
      setUploadPercent(100);
      setPhase("analyzing");
    } catch (err) {
      setError(importErrorMessage(err));
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  function handleFiles(files: FileList | null) {
    const first = files?.[0];
    if (first) void runUpload(first);
  }

  // A database file dropped on the single-file tab is handed over here and uploaded once.
  useEffect(() => {
    if (!initialFile) return;
    onInitialFileUsed?.();
    // One-shot start for a file handed over by the parent (an external event, not derived state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runUpload(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  function setTableEntity(name: string, entity: string) {
    setTables((list) =>
      list.map((t) => (t.name === name ? { ...t, entity, skip: false } : t)),
    );
  }

  function toggleSkip(name: string) {
    setTables((list) =>
      list.map((t) => (t.name === name ? { ...t, skip: !t.skip } : t)),
    );
  }

  function setColumnMapping(tableName: string, column: string, field: string | null) {
    setTables((list) =>
      list.map((t) =>
        t.name === tableName
          ? { ...t, mapping: { ...t.mapping, [column]: field } }
          : t,
      ),
    );
  }

  const checks = detail?.health?.checks ?? [];
  const hasError = checks.some((c) => c.level === "error");
  const hasWarn = checks.some((c) => c.level === "warn");
  const missingEntities = tables.filter((t) => !t.skip && !t.entity);
  const mappedCount = tables.filter((t) => !t.skip && t.entity).length;

  const canCommit =
    phase === "review" &&
    !busy &&
    !hasError &&
    missingEntities.length === 0 &&
    mappedCount > 0 &&
    (!hasWarn || warnConfirmed);

  async function handleCommit() {
    if (!packageId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await commitImportPackage(packageId, {
        tables: tables.map((t) => ({
          name: t.name,
          entity: t.entity,
          mapping: t.mapping,
          skip: t.skip,
        })),
      });
      setBatchId(res.batchId);
      setPhase("committing");
    } catch (err) {
      setError(importErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPhase("upload");
    setFile(null);
    setPackageId(null);
    setDetail(null);
    setProgress(null);
    setBatchId(null);
    setTables([]);
    setExpanded({});
    setWarnConfirmed(false);
    setUploadPercent(0);
    setError(null);
    loadBatches();
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleUndo(id: string) {
    setUndoing(id);
    setUndoConfirm(null);
    try {
      await undoImportBatch(id);
      loadBatches();
    } catch (err) {
      setBatchesError(importErrorMessage(err));
    } finally {
      setUndoing(null);
    }
  }

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap gap-2 text-xs" aria-label="مراحل انتقال دیتابیس">
        {PHASE_LABELS.map(([key, label]) => (
          <li
            key={key}
            aria-current={phase === key ? "step" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 ring-1",
              phase === key
                ? "bg-indigo-500/15 font-bold text-indigo-300 ring-indigo-500/40"
                : "text-muted-foreground ring-border",
            )}
          >
            {label}
          </li>
        ))}
      </ol>

      <ErrorNotice title="انتقال دیتابیس انجام نشد" message={error} />

      {phase === "upload" && (
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
            <Database className="size-12 text-indigo-400" aria-hidden="true" />
          )}
          <p className="text-lg font-bold">
            {busy ? "در حال بارگذاری بسته..." : "بستهٔ کامل کسب‌وکار را اینجا رها کنید"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            فایل دیتابیس (sqlite، db)، خروجی SQL یا فایل فشردهٔ CSV/XLSX تا{" "}
            {formatNumber(PACKAGE_MAX_BYTES / 1024 / 1024)} مگابایت. سیستم ساختار
            جدول‌ها، روابط، واحدها و سلامت داده را تحلیل می‌کند و قبل از انتقال همه
            چیز را نشان می‌دهد.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={PACKAGE_ACCEPT}
            className="sr-only"
            id="package-import-file"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button
            size="lg"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            انتخاب بسته
          </Button>
          <span className="text-xs text-muted-foreground" dir="ltr">
            sqlite · sqlite3 · db · sql · zip
          </span>
          {busy && (
            <div className="mt-2 w-full max-w-sm">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                بارگذاری {formatNumber(uploadPercent)}٪
              </p>
            </div>
          )}
        </div>
      )}

      {phase === "analyzing" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="size-10 animate-spin text-indigo-400" aria-hidden="true" />
            <p className="text-base font-bold">در حال تحلیل بستهٔ دیتابیس...</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {file?.name} — ساختار جدول‌ها، نوع داده‌ها، روابط و کیفیت اطلاعات
              بررسی می‌شود. این کار ممکن است چند لحظه طول بکشد.
            </p>
          </CardContent>
        </Card>
      )}

      {phase === "review" && detail && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <Database className="size-4 text-indigo-400" aria-hidden="true" />
                بسته: {file?.name ?? packageId}
                <Badge variant="secondary">
                  {formatNumber(tables.length)} جدول
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              جدول‌های شناسایی‌شده را بررسی کنید. نوع موجودیت هر جدول را می‌توانید
              تغییر دهید یا جدول‌های نامرتبط را نادیده بگیرید.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>جدول‌های بسته</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {tables.map((t) => {
                const meta = detail.tables.find((x) => x.name === t.name);
                const fields = entityDefByKey.get(t.entity)?.fields ?? [];
                const isOpen = Boolean(expanded[t.name]);
                const entityOptions =
                  entities.length > 0
                    ? entities.map((e) => ({ key: e.key, labelFa: e.labelFa }))
                    : Object.keys(PACKAGE_ENTITY_LABELS).map((key) => ({
                        key,
                        labelFa: packageEntityLabel(key),
                      }));
                if (t.entity && !entityOptions.some((o) => o.key === t.entity)) {
                  entityOptions.push({
                    key: t.entity,
                    labelFa: packageEntityLabel(t.entity),
                  });
                }
                return (
                  <div
                    key={t.name}
                    className={cn(
                      "rounded-xl ring-1 ring-border",
                      t.skip && "opacity-60",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-3 p-3">
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((e) => ({ ...e, [t.name]: !e[t.name] }))
                        }
                        aria-expanded={isOpen}
                        className="flex items-center gap-1.5 text-sm font-bold"
                      >
                        {isOpen ? (
                          <ChevronDown className="size-4" aria-hidden="true" />
                        ) : (
                          <ChevronLeft className="size-4" aria-hidden="true" />
                        )}
                        <span dir="ltr">{t.name}</span>
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {formatNumber(meta?.rowCount ?? 0)} ردیف
                      </span>
                      {meta?.confidence !== undefined && (
                        <Badge variant="secondary">
                          اطمینان {formatNumber(Math.round(meta.confidence * 100))}٪
                        </Badge>
                      )}
                      {meta?.reason && (
                        <span className="text-xs text-amber-400">{meta.reason}</span>
                      )}
                      <div className="ms-auto flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">نوع:</span>
                          <select
                            value={t.entity}
                            disabled={busy}
                            onChange={(e) => setTableEntity(t.name, e.target.value)}
                            aria-label={`نوع موجودیت برای ${t.name}`}
                            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                          >
                            <option value="">— نامشخص —</option>
                            {entityOptions.map((o) => (
                              <option key={o.key} value={o.key}>
                                {o.labelFa}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={Boolean(t.skip)}
                            onChange={() => toggleSkip(t.name)}
                            className="size-4 accent-indigo-500"
                          />
                          نادیده بگیر
                        </label>
                      </div>
                    </div>

                    {isOpen && meta && (
                      <div className="overflow-x-auto border-t border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>ستون</TableHead>
                              <TableHead>نوع</TableHead>
                              <TableHead>نمونه</TableHead>
                              <TableHead>فیلد مقصد</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {meta.columns.map((column) => {
                              const current = t.mapping[column.name] ?? "";
                              const options = fields.map((f) => ({
                                key: f.key,
                                labelFa: f.labelFa,
                              }));
                              if (current && !options.some((o) => o.key === current)) {
                                options.push({ key: current, labelFa: current });
                              }
                              return (
                                <TableRow key={column.name}>
                                  <TableCell className="font-medium" dir="ltr">
                                    {column.name}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground" dir="ltr">
                                    {column.type || "—"}
                                  </TableCell>
                                  <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                                    {(column.sample ?? [])
                                      .map((v) => (v === null || v === undefined ? "" : String(v)))
                                      .filter(Boolean)
                                      .join(" ، ")}
                                  </TableCell>
                                  <TableCell>
                                    {fields.length > 0 ? (
                                      <select
                                        value={current}
                                        disabled={busy}
                                        onChange={(e) =>
                                          setColumnMapping(
                                            t.name,
                                            column.name,
                                            e.target.value || null,
                                          )
                                        }
                                        aria-label={`فیلد مقصد برای ${t.name}.${column.name}`}
                                        className="h-8 w-full min-w-40 rounded-lg border border-input bg-background px-2 text-sm"
                                      >
                                        <option value="">— نادیده گرفتن —</option>
                                        {options.map((o) => (
                                          <option key={o.key} value={o.key}>
                                            {o.labelFa}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">
                                        {current || "—"}
                                      </span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })}
              {missingEntities.length > 0 && (
                <p className="text-xs text-amber-400">
                  جدول‌های بدون نوع موجودیت:{" "}
                  {missingEntities.map((t) => t.name).join("، ")} — یا نوع انتخاب
                  کنید یا «نادیده بگیر» را بزنید.
                </p>
              )}
            </CardContent>
          </Card>

          {detail.relationships.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="size-4 text-indigo-400" aria-hidden="true" />
                  روابط جدول‌ها
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>از</TableHead>
                      <TableHead>به</TableHead>
                      <TableHead>تطابق</TableHead>
                      <TableHead>وضعیت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.relationships.map((rel, i) => (
                      <TableRow key={`${rel.fromTable}-${rel.fromColumn}-${i}`}>
                        <TableCell className="text-xs" dir="ltr">
                          {rel.fromTable}.{rel.fromColumn}
                        </TableCell>
                        <TableCell className="text-xs" dir="ltr">
                          {rel.toTable}.{rel.toColumn}
                        </TableCell>
                        <TableCell>{formatNumber(Math.round(rel.matchRatio * 100))}٪</TableCell>
                        <TableCell>
                          {rel.declared ? (
                            <Badge variant="secondary">تعریف‌شده</Badge>
                          ) : (
                            <Badge variant="outline">استنتاجی</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {hasError ? (
                  <ShieldAlert className="size-4 text-rose-400" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4 text-emerald-400" aria-hidden="true" />
                )}
                سلامت داده
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {checks.length === 0 && (
                <p className="text-sm text-muted-foreground">بررسی سلامتی گزارش نشده است.</p>
              )}
              {checks.map((check) => (
                <div
                  key={check.key}
                  className={cn("flex flex-col gap-1 rounded-xl p-3 ring-1", healthTone(check.level))}
                >
                  <span className="flex items-center gap-2 text-sm font-bold">
                    {healthIcon(check.level)}
                    {check.titleFa}
                    {check.value !== undefined && (
                      <span className="ms-auto text-xs text-muted-foreground">
                        {typeof check.value === "number"
                          ? formatNumber(check.value)
                          : check.value}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{check.detailFa}</span>
                </div>
              ))}
              {hasError && (
                <p className="text-xs text-rose-400 sm:col-span-2">
                  تا رفع خطاهای سطح «error» امکان انتقال وجود ندارد.
                </p>
              )}
              {!hasError && hasWarn && (
                <label className="flex items-center gap-2 text-xs text-amber-400 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={warnConfirmed}
                    onChange={(e) => setWarnConfirmed(e.target.checked)}
                    className="size-4 accent-amber-500"
                  />
                  هشدارها را بررسی کردم و مسئولیت ادامهٔ انتقال را می‌پذیرم.
                </label>
              )}
            </CardContent>
          </Card>

          {detail.currencies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Coins className="size-4 text-indigo-400" aria-hidden="true" />
                  واحدهای پول
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>مقدار خام</TableHead>
                      <TableHead>مقدار نرمال‌شده</TableHead>
                      <TableHead>تعداد</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.currencies.map((c, i) => (
                      <TableRow key={`${c.raw}-${i}`}>
                        <TableCell dir="ltr">{c.raw}</TableCell>
                        <TableCell>{c.normalized}</TableCell>
                        <TableCell>{formatNumber(c.count)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap gap-2">
            <Button disabled={!canCommit} onClick={handleCommit}>
              {busy
                ? "در حال آغاز انتقال..."
                : `تأیید و انتقال ${formatNumber(mappedCount)} جدول`}
            </Button>
            <Button variant="outline" disabled={busy} onClick={reset}>
              انصراف
            </Button>
          </div>
        </>
      )}

      {phase === "committing" && (
        <Card>
          <CardContent className="flex flex-col gap-4 py-8">
            <div className="flex items-center gap-2">
              <Loader2 className="size-5 animate-spin text-indigo-400" aria-hidden="true" />
              <span className="font-bold">در حال انتقال داده‌ها...</span>
              <span className="ms-auto text-sm text-muted-foreground">
                {formatNumber(progress?.done ?? 0)} / {formatNumber(progress?.total ?? 0)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            {progress && (
              <div className="flex flex-col gap-2">
                {Object.entries(progress.inserted).map(([key, count]) => (
                  <div
                    key={`inserted-${key}`}
                    className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm"
                  >
                    <CheckCircle2 className="size-4 text-emerald-400" aria-hidden="true" />
                    <span>{packageEntityLabel(key)}</span>
                    <span className="ms-auto font-bold">{formatNumber(count)}</span>
                  </div>
                ))}
                {Object.entries(progress.skipped).map(([key, count]) => (
                  <div
                    key={`skipped-${key}`}
                    className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm"
                  >
                    <TriangleAlert className="size-4 text-amber-400" aria-hidden="true" />
                    <span>{packageEntityLabel(key)} (تکراری)</span>
                    <span className="ms-auto font-bold">{formatNumber(count)}</span>
                  </div>
                ))}
                {progress.errors.length > 0 && (
                  <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs text-rose-400">
                    {progress.errors.slice(0, 50).map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {phase === "done" && (
        <Card className="ring-1 ring-emerald-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="size-5" aria-hidden="true" />
              انتقال دیتابیس انجام شد
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {progress && (
              <div className="flex flex-col gap-2">
                {Object.entries(progress.inserted).map(([key, count]) => (
                  <div
                    key={`inserted-${key}`}
                    className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm"
                  >
                    <span>{packageEntityLabel(key)}</span>
                    <span className="ms-auto font-bold">{formatNumber(count)}</span>
                  </div>
                ))}
                {Object.entries(progress.skipped).map(([key, count]) => (
                  <div
                    key={`skipped-${key}`}
                    className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm"
                  >
                    <span>{packageEntityLabel(key)} (تکراری)</span>
                    <span className="ms-auto font-bold">{formatNumber(count)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <a
                href="#package-recent-imports"
                className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm text-primary-foreground"
              >
                بازگردانی این انتقال
              </a>
              <Button variant="outline" onClick={reset}>
                انتقال بستهٔ دیگر
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card id="package-recent-imports">
        <CardHeader>
          <CardTitle>ورودهای اخیر</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ErrorNotice title="خطا در دریافت سوابق ورود" message={batchesError} />
          {batchId && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-400">
              <FileArchive className="size-3.5" aria-hidden="true" />
              آخرین بستهٔ منتقل‌شده در فهرست زیر قابل بازگردانی است.
            </p>
          )}
          {batches.length === 0 && !batchesError && (
            <p className="text-sm text-muted-foreground">هنوز داده‌ای وارد نشده است.</p>
          )}
          {batches.length > 0 && (
            <div className="overflow-x-auto">
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
                    <TableRow
                      key={b.batchId}
                      className={cn(b.batchId === batchId && "bg-emerald-500/5")}
                    >
                      <TableCell className="max-w-48 truncate font-medium">{b.fileName}</TableCell>
                      <TableCell>{packageEntityLabel(b.entity)}</TableCell>
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
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setUndoConfirm(null)}
                            >
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
