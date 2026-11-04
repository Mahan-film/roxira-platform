"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Pause, Play, RotateCcw, UploadCloud, X } from "lucide-react";

import { ErrorNotice } from "@/components/app/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError } from "@/lib/api/http-client";
import {
  BULK_ACTIVE,
  approveBulkJob,
  bulkStatusLabel,
  cancelBulkJob,
  formatBytes,
  getBulkConfig,
  getBulkJob,
  getBulkRows,
  listBulkJobs,
  pauseBulkJob,
  resumeBulkJob,
  retryBulkJob,
  uploadBulkFile,
  type BulkConfig,
  type BulkJob,
  type BulkRows,
} from "@/lib/api/bulk-import-client";
import { listImportEntities, type ImportEntityDef } from "@/lib/api/data-import-suite-client";
import { formatNumber } from "@/lib/fa-format";
import { cn } from "@/lib/utils";

function errorText(error: unknown): string {
  if (error instanceof ApiClientError) return error.details.join(" | ") || "درخواست انجام نشد.";
  if (error instanceof DOMException && error.name === "AbortError") return "بارگذاری متوقف شد.";
  return "ارتباط با سرور برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";
}

interface Pick {
  include: boolean;
  entity: string;
}

/**
 * Bulk import: any file size. Files go straight to object storage in resumable parts, a background job
 * reads them in a stream, and nothing is posted until the user has looked at the staged tables and
 * confirmed. Pause, resume, retry and cancel are available while the job runs.
 */
export function BulkImportPanel({
  incomingFile = null,
  onIncomingFileUsed,
}: {
  /** A file over 5 MB, or a database dump or archive, handed over by the import wizard below (#277). */
  incomingFile?: File | null;
  onIncomingFileUsed?: () => void;
} = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<BulkConfig | null>(null);
  const [jobs, setJobs] = useState<BulkJob[]>([]);
  const [entities, setEntities] = useState<ImportEntityDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Record<string, { name: string; sent: number; total: number }>>({});
  const [dragging, setDragging] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [preview, setPreview] = useState<{ idx: number; data: BulkRows } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const aborts = useRef<Record<string, AbortController>>({});
  const resumeInput = useRef<HTMLInputElement>(null);
  const resumeFor = useRef<BulkJob | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs(await listBulkJobs());
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void getBulkConfig().then(setConfig).catch((e) => setError(errorText(e)));
    void listImportEntities().then(setEntities).catch(() => undefined);
    void listBulkJobs().then(setJobs).catch((e) => setError(errorText(e)));
  }, []);

  const anyActive = useMemo(() => jobs.some((j) => BULK_ACTIVE.includes(j.status)) || Object.keys(uploads).length > 0, [jobs, uploads]);
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [anyActive, refresh]);

  async function upload(file: File, jobId?: string) {
    setError(null);
    const controller = new AbortController();
    const key = jobId ?? `${file.name}-${file.size}-${Date.now()}`;
    aborts.current[key] = controller;
    setUploads((u) => ({ ...u, [key]: { name: file.name, sent: 0, total: file.size } }));
    try {
      await uploadBulkFile(file, {
        jobId,
        signal: controller.signal,
        onProgress: (sent, total) => setUploads((u) => (u[key] ? { ...u, [key]: { name: file.name, sent, total } } : u)),
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      delete aborts.current[key];
      setUploads((u) => {
        const rest = { ...u };
        delete rest[key];
        return rest;
      });
      void refresh();
      void getBulkConfig().then(setConfig).catch(() => undefined);
    }
  }

  // A large file picked in the wizard starts here, once the server's bulk config is known.
  useEffect(() => {
    if (!incomingFile || !config) return;
    onIncomingFileUsed?.();
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!config.enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(
        `«${incomingFile.name}» (${formatBytes(incomingFile.size)}) برای زبانهٔ «انتقال کامل دیتابیس» بزرگ است و ورود حجیم هنوز روی این سرور فعال نشده است. فایل را به چند بخش کوچک‌تر تقسیم کنید یا خروجی هر جدول را جدا بگیرید.`,
      );
      return;
    }
    void upload(incomingFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingFile, config]);

  function onFiles(list: FileList | null) {
    if (!list) return;
    Array.from(list).forEach((file) => void upload(file));
  }

  async function control(fn: () => Promise<BulkJob>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
    void refresh();
  }

  async function openReview(job: BulkJob) {
    setReviewing(job.id);
    setConfirmed(false);
    setPreview(null);
    try {
      const full = await getBulkJob(job.id);
      const next: Record<number, Pick> = {};
      full.tables.forEach((table) => {
        const suggestion = full.review?.find((r) => r.name === table.name);
        next[table.idx] = { include: Boolean(suggestion?.detectedEntity), entity: suggestion?.detectedEntity ?? "" };
      });
      setPicks(next);
      setJobs((all) => all.map((j) => (j.id === full.id ? full : j)));
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function showRows(job: BulkJob, idx: number) {
    try {
      setPreview({ idx, data: await getBulkRows(job.id, idx, 0, 20) });
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function approve(job: BulkJob) {
    const tables = job.tables.map((table) => {
      const pick = picks[table.idx];
      const suggestion = job.review?.find((r) => r.name === table.name);
      const useful = pick?.include && pick.entity;
      return {
        idx: table.idx,
        entity: pick?.entity || "crm-leads",
        mapping: pick?.entity === suggestion?.detectedEntity ? (suggestion?.mapping ?? {}) : {},
        skip: !useful,
        moneyToRial: suggestion?.moneyUnit?.toRial ?? undefined,
      };
    });
    await control(() => approveBulkJob(job.id, tables));
    setReviewing(null);
  }

  const quotaPercent = config && config.quotaBytes > 0 ? Math.min(100, Math.round((config.usedBytes / config.quotaBytes) * 100)) : 0;

  return (
    <div ref={rootRef} className="flex flex-col gap-4" dir="rtl">
      <ErrorNotice title="ورود حجیم انجام نشد" message={error} />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-indigo-400 bg-indigo-500/15" : "border-indigo-500/40 bg-indigo-500/5",
        )}
      >
        <UploadCloud className="size-12 text-indigo-400" aria-hidden="true" />
        <p className="text-lg font-bold">فایل یا دیتابیس کامل را رها کنید؛ هر اندازه‌ای</p>
        <p className="max-w-xl text-sm text-muted-foreground">
          CSV، اکسل، دامپ SQL و ZIP از هر حجمی. فایل مستقیم و تکه‌تکه بارگذاری می‌شود، اگر قطع شد از همان‌جا ادامه می‌یابد،
          و بدون محدودیت تعداد ردیف یا تعداد فایل در روز خوانده می‌شود. هیچ چیز پیش از بازبینی و تأیید شما ثبت نمی‌شود.
        </p>
        <Button type="button" onClick={() => inputRef.current?.click()} disabled={config?.enabled === false}>
          انتخاب فایل
        </Button>
        <input ref={inputRef} type="file" multiple className="sr-only" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        {config?.enabled === false && <p className="text-sm text-amber-400">بارگذاری حجیم هنوز روی این سرور فعال نشده است.</p>}
        {config && config.enabled && (
          <p className="text-xs text-muted-foreground">
            فضای سازمان: {formatBytes(config.usedBytes)} از {formatBytes(config.quotaBytes)} ({formatNumber(quotaPercent)}٪)
          </p>
        )}
      </div>

      <input
        ref={resumeInput}
        type="file"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const job = resumeFor.current;
          e.target.value = "";
          if (!file || !job) return;
          if (file.size !== job.sizeBytes) {
            setError(`این فایل با فایل اصلی (${formatBytes(job.sizeBytes)}) یکی نیست.`);
            return;
          }
          void upload(file, job.id);
        }}
      />

      {jobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ورودهای شما</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {jobs.map((job) => {
              const up = uploads[job.id] ?? Object.values(uploads).find((u) => u.name === job.fileName && job.status === "uploading");
              const percent = up ? Math.round((up.sent / Math.max(1, up.total)) * 100) : job.percent;
              const active = BULK_ACTIVE.includes(job.status);
              return (
                <div key={job.id} className="flex flex-col gap-2 rounded-2xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="font-bold" dir="ltr">{job.fileName}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(job.sizeBytes)} · {formatNumber(job.rowsStaged)} ردیف خوانده‌شده
                      </span>
                    </div>
                    <Badge variant={job.status === "failed" ? "destructive" : "secondary"}>{bulkStatusLabel(job.status)}</Badge>
                  </div>
                  {(active || job.status === "paused") && (
                    <div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-indigo-500 transition-all" style={{ width: `${percent}%` }} />
                    </div>
                  )}
                  {job.error && <p className="text-sm text-destructive">{job.error}</p>}
                  {job.postProgress && job.postProgress.phase !== "posted" && (
                    <p className="text-sm">ثبت: {formatNumber(job.postProgress.done)} از {formatNumber(job.postProgress.total)}</p>
                  )}
                  {job.status === "posted" && job.postProgress && (
                    <p className="flex items-center gap-1 text-sm text-emerald-400">
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      ثبت شد: {Object.entries(job.postProgress.inserted).map(([k, v]) => `${k}: ${formatNumber(v)}`).join("، ") || "—"}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {job.status === "uploading" && !up && (
                      <Button size="sm" variant="outline" onClick={() => { resumeFor.current = job; resumeInput.current?.click(); }}>
                        <Play className="size-4" aria-hidden="true" /> ادامهٔ بارگذاری
                      </Button>
                    )}
                    {job.status === "uploading" && up && (
                      <Button size="sm" variant="outline" onClick={() => aborts.current[job.id]?.abort()}>
                        <Pause className="size-4" aria-hidden="true" /> توقف بارگذاری
                      </Button>
                    )}
                    {job.status === "running" && (
                      <Button size="sm" variant="outline" onClick={() => void control(() => pauseBulkJob(job.id))}>
                        <Pause className="size-4" aria-hidden="true" /> توقف
                      </Button>
                    )}
                    {job.status === "paused" && (
                      <Button size="sm" variant="outline" onClick={() => void control(() => resumeBulkJob(job.id))}>
                        <Play className="size-4" aria-hidden="true" /> ادامه
                      </Button>
                    )}
                    {job.status === "failed" && (
                      <Button size="sm" variant="outline" onClick={() => void control(() => retryBulkJob(job.id))}>
                        <RotateCcw className="size-4" aria-hidden="true" /> تلاش دوباره
                      </Button>
                    )}
                    {job.status === "ready" && (
                      <Button size="sm" onClick={() => void openReview(job)}>بازبینی و ثبت</Button>
                    )}
                    {["uploading", "queued", "running", "pausing", "paused", "failed", "ready"].includes(job.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          // Stop the parts still being sent from this tab, then cancel the job on the server.
                          Object.entries(aborts.current).forEach(([key, controller]) => {
                            if (key === job.id || uploads[key]?.name === job.fileName) controller.abort();
                          });
                          void control(() => cancelBulkJob(job.id));
                        }}
                      >
                        <X className="size-4" aria-hidden="true" /> لغو
                      </Button>
                    )}
                    {job.status === "running" && <Loader2 className="size-4 animate-spin text-indigo-400" aria-hidden="true" />}
                  </div>

                  {reviewing === job.id && job.status === "ready" && (
                    <div className="mt-2 flex flex-col gap-3 border-t pt-3">
                      {job.notes.length > 0 && (
                        <ul className="list-disc pr-5 text-xs text-muted-foreground">
                          {job.notes.slice(0, 8).map((n) => <li key={n}>{n}</li>)}
                        </ul>
                      )}
                      {job.tables.map((table) => {
                        const pick = picks[table.idx] ?? { include: false, entity: "" };
                        const suggestion = job.review?.find((r) => r.name === table.name);
                        return (
                          <div key={table.idx} className="flex flex-col gap-2 rounded-xl bg-muted/30 p-3">
                            <label className="flex flex-wrap items-center gap-2">
                              <input type="checkbox" checked={pick.include} onChange={(e) => setPicks((p) => ({ ...p, [table.idx]: { ...pick, include: e.target.checked } }))} />
                              <span className="font-bold" dir="ltr">{table.name}</span>
                              <span className="text-xs text-muted-foreground">{formatNumber(table.rows)} ردیف · {formatNumber(table.columns.length)} ستون</span>
                              <select
                                aria-label={`نوع داده ${table.name}`}
                                className="rounded-md border bg-background px-2 py-1 text-sm"
                                value={pick.entity}
                                onChange={(e) => setPicks((p) => ({ ...p, [table.idx]: { include: Boolean(e.target.value), entity: e.target.value } }))}
                              >
                                <option value="">— نادیده بگیر —</option>
                                {entities.map((entity) => <option key={entity.key} value={entity.key}>{entity.labelFa}</option>)}
                              </select>
                              <Button type="button" size="sm" variant="ghost" onClick={() => void showRows(job, table.idx)}>نمایش ۲۰ ردیف اول</Button>
                            </label>
                            {suggestion?.reason && !pick.entity && <p className="text-xs text-muted-foreground">{suggestion.reason}</p>}
                            {pick.entity && pick.entity !== suggestion?.detectedEntity && (
                              <p className="text-xs text-amber-400">ستون‌ها برای این نوع به‌صورت خودکار از روی نام سربرگ نگاشت می‌شوند.</p>
                            )}
                            {preview?.idx === table.idx && (
                              <div className="max-h-64 overflow-auto rounded-lg border text-xs" dir="ltr">
                                <table className="w-full">
                                  <thead><tr>{preview.data.columns.map((c) => <th key={c} className="px-2 py-1 text-left">{c}</th>)}</tr></thead>
                                  <tbody>
                                    {preview.data.rows.map((r) => (
                                      <tr key={r.rowNo}>{preview.data.columns.map((_c, i) => <td key={i} className="max-w-48 truncate px-2 py-1">{r.cells[i] ?? ""}</td>)}</tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                        جدول‌ها و ردیف‌های نمونه را دیده‌ام و ثبت را تأیید می‌کنم (کل ثبت با یک دکمه قابل بازگردانی است).
                      </label>
                      <div>
                        <Button disabled={!confirmed || !Object.values(picks).some((p) => p.include && p.entity)} onClick={() => void approve(job)}>
                          ثبت در سیستم
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
