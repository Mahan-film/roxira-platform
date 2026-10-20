"use client";

import { useCallback, useEffect, useState } from "react";
import { adminGet, adminPost, AdminApiError } from "@/lib/api/admin-console-client";
import { GuideContent } from "@/lib/guides-markdown";
import { Badge, Btn, Card, ErrorBox, fa, Field, Notice, Select, Spinner, TableWrap, Td, Th, TextArea, TextInput, useAction, useAdminData, when } from "./admin-ui";

// ----------------------------------------------------------------- research
interface ResearchState {
  job_id: string;
  state: "queued" | "running" | "done" | "error";
  elapsed_s: number;
  timeout_s: number;
  stage: string;
  error: string | null;
  result: { report_markdown: string; sources: { url: string; title: string }[]; duration_s?: number; costs?: number | null } | null;
}

function ResearchBox({ onAuthLost }: { onAuthLost: () => void }) {
  const [query, setQuery] = useState("");
  const [reportType, setReportType] = useState("research_report");
  const [maxSources, setMaxSources] = useState("8");
  const [job, setJob] = useState<ResearchState | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  const startFn = useCallback(
    async (body: { query: string; report_type: string; max_sources: number }) => adminPost<{ job_id: string }>("/research", body),
    [],
  );
  const start = useAction(startFn, onAuthLost);

  async function go() {
    setJob(null);
    setPollError(null);
    const res = await start.run({ query: query.trim(), report_type: reportType, max_sources: Number(maxSources) || 8 });
    if (res) {
      setJob({ job_id: res.job_id, state: "queued", elapsed_s: 0, timeout_s: 900, stage: "در صف", error: null, result: null });
    }
  }

  const active = job && (job.state === "queued" || job.state === "running") ? job.job_id : null;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const tick = async () => {
      try {
        const s = await adminGet<ResearchState>(`/research/${active}`);
        if (stopped) return;
        setJob(s);
        setPollError(null);
      } catch (e) {
        if (stopped) return;
        if (e instanceof AdminApiError && e.status === 401) onAuthLost();
        setPollError(e instanceof Error ? e.message : "خطا در دریافت وضعیت");
      }
    };
    const timer = window.setInterval(() => void tick(), 4000);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [active, onAuthLost]);

  const pct = job ? Math.min(100, Math.round((job.elapsed_s / job.timeout_s) * 100)) : 0;
  return (
    <Card title="جعبهٔ پژوهش عمیق (GPT-Researcher + SearXNG)">
      <Notice tone="warn">فقط پرسش‌های عمومی. مدل‌های رایگان ممکن است متن را ثبت کنند؛ هرگز داده پرونده یا مشتری وارد نکنید.</Notice>
      <form className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <div className="sm:col-span-3">
          <Field label="پرسش پژوهشی"><TextArea rows={3} value={query} onChange={(e) => setQuery(e.target.value)} maxLength={1500} placeholder="مثلاً: مهلت تجدیدنظرخواهی از رأی دادگاه حقوقی چیست و منابع آن کدام است؟" /></Field>
        </div>
        <Field label="نوع گزارش">
          <Select value={reportType} onChange={(e) => setReportType(e.target.value)}>
            <option value="research_report">گزارش پژوهشی</option><option value="resource_report">فهرست منابع</option><option value="outline_report">طرح کلی</option>
          </Select>
        </Field>
        <Field label="حداکثر منبع"><TextInput dir="ltr" inputMode="numeric" value={maxSources} onChange={(e) => setMaxSources(e.target.value.replace(/\D/g, ""))} /></Field>
        <div className="self-end"><Btn type="submit" disabled={start.busy || query.trim().length < 5 || !!active}>شروع پژوهش</Btn></div>
      </form>
      {start.error && <div className="mt-3"><Notice tone="danger">{start.error}</Notice></div>}
      {job && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={job.state === "done" ? "ok" : job.state === "error" ? "danger" : "cyan"}>{job.state}</Badge>
            <span className="text-[var(--gh-muted)]">{job.stage}</span>
            <span className="tabular-nums text-[var(--gh-muted)]">{fa(job.elapsed_s)} ثانیه از حداکثر {fa(job.timeout_s)}</span>
          </div>
          {(job.state === "queued" || job.state === "running") && (
            <div className="h-2 overflow-hidden rounded-full bg-[var(--gh-surface-2)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="زمان سپری‌شده از سقف پژوهش">
              <div className="h-full bg-[var(--gh-cyan)] transition-all" style={{ width: `${Math.max(pct, 3)}%` }} />
            </div>
          )}
          {pollError && <Notice tone="warn">{pollError}</Notice>}
          {job.error && <Notice tone="danger">{job.error}</Notice>}
          {job.result && (
            <div className="space-y-3">
              <div className="rounded-xl border border-[var(--gh-border)] bg-[var(--gh-bg-2)] p-3 sm:p-4">
                <GuideContent markdown={job.result.report_markdown} resolveCitation={() => null} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-[var(--gh-gold)]">منابع ({fa(job.result.sources.length)})</h3>
                <ul className="space-y-1 text-sm">
                  {job.result.sources.map((s) => (
                    <li key={s.url} className="break-all">
                      {/^https?:\/\//.test(s.url) ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="text-[var(--gh-cyan)] underline">{s.title || s.url}</a>
                      ) : <span dir="ltr">{s.url}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// --------------------------------------------------------------- site check
interface Check { name: string; level: "ok" | "warn" | "fail" | "info"; detail: string }
interface SiteReport {
  requested: string;
  user_agent: string;
  robots: { allowed: boolean; note: string };
  fetched: boolean;
  status?: number;
  ttfb_ms?: number;
  total_ms?: number;
  bytes?: number;
  content_type?: string;
  redirect_to?: string;
  headers?: Record<string, string>;
  seo?: { title: string; description: string; canonical: string | null; lang: string | null; hreflang: { lang: string; href: string }[]; structured_data_types: string[]; og: Record<string, string> } | null;
  checks?: Check[];
}

const LEVEL_TONE: Record<Check["level"], "ok" | "warn" | "danger" | "muted"> = { ok: "ok", warn: "warn", fail: "danger", info: "muted" };

function SiteCheck({ onAuthLost }: { onAuthLost: () => void }) {
  const [url, setUrl] = useState("https://");
  const [report, setReport] = useState<SiteReport | null>(null);
  const fn = useCallback(async (u: string) => adminPost<{ report: SiteReport }>("/site-check", { url: u }), []);
  const check = useAction(fn, onAuthLost);

  async function go() {
    setReport(null);
    const res = await check.run(url.trim());
    if (res) setReport(res.report);
  }

  return (
    <Card title="بررسی سایت (یک درخواست مؤدبانه)">
      <p className="mb-3 text-xs text-[var(--gh-muted)]">
        سرور با شناسهٔ <span dir="ltr" className="font-mono">RoxiraBot/1.0 (+https://ghazihoushmand.ir)</span> فقط یک صفحه را می‌خواند، robots.txt را رعایت می‌کند، ریدایرکت را دنبال نمی‌کند و آدرس‌های داخلی را رد می‌کند. دورزدن ضدربات، کپچا یا اثرانگشت مرورگر وجود ندارد.
      </p>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <TextInput dir="ltr" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="آدرس سایت" maxLength={500} />
        <Btn type="submit" disabled={check.busy || url.trim().length < 8}>{check.busy ? "در حال بررسی…" : "بررسی"}</Btn>
      </form>
      {check.error && <div className="mt-3"><Notice tone="danger">{check.error}</Notice></div>}
      {report && (
        <div className="mt-4 space-y-3">
          <Notice tone={report.robots.allowed ? "info" : "warn"}>{report.robots.note}</Notice>
          {report.fetched && (
            <>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge tone={report.status && report.status < 400 ? "ok" : "danger"}>HTTP {report.status}</Badge>
                <Badge>{fa(report.ttfb_ms)} ms تا اولین بایت</Badge>
                <Badge>{fa((report.bytes ?? 0) / 1024)} KB</Badge>
                <Badge>{report.content_type}</Badge>
                {report.redirect_to && <Badge tone="warn">ریدایرکت به {report.redirect_to}</Badge>}
              </div>
              {report.seo && (
                <div className="space-y-1 rounded-xl border border-[var(--gh-border)] bg-[var(--gh-bg-2)] p-3 text-sm">
                  <div><span className="text-[var(--gh-muted)]">عنوان: </span>{report.seo.title || "—"}</div>
                  <div><span className="text-[var(--gh-muted)]">توضیحات: </span>{report.seo.description || "—"}</div>
                  <div dir="ltr" className="break-all text-left"><span className="text-[var(--gh-muted)]">canonical: </span>{report.seo.canonical ?? "—"}</div>
                  <div><span className="text-[var(--gh-muted)]">hreflang: </span>{report.seo.hreflang.map((h) => h.lang).join("، ") || "—"}</div>
                  <div><span className="text-[var(--gh-muted)]">داده ساختاریافته: </span>{report.seo.structured_data_types.join("، ") || "—"}</div>
                </div>
              )}
              {report.checks && (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {report.checks.map((c) => (
                    <li key={c.name} className="flex items-start gap-2 rounded-xl border border-[var(--gh-border)] p-2 text-sm">
                      <Badge tone={LEVEL_TONE[c.level]}>{c.level}</Badge>
                      <span><span className="font-mono text-xs text-[var(--gh-muted)]">{c.name}</span><br />{c.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              {report.headers && (
                <details>
                  <summary className="cursor-pointer text-sm text-[var(--gh-cyan)]">هدرهای پاسخ</summary>
                  <pre dir="ltr" className="mt-2 max-h-64 overflow-auto rounded-xl border border-[var(--gh-border)] bg-[var(--gh-bg-2)] p-3 text-left text-xs">
                    {Object.entries(report.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}
                  </pre>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------- agent tasks
interface TaskRow {
  id: number;
  slug: string;
  status: string;
  step_idx: number;
  attempts: number;
  priority: number;
  public: number;
  reason: string;
  branch: string | null;
  updated: number;
  ladder: string;
}
const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "cyan" | "muted"> = { done: "ok", running: "cyan", queued: "warn", failed: "danger", cancelled: "muted" };
const LADDER_STEPS = ["best", "free", "ds-flash", "strong"] as const;

function TaskQueue({ onAuthLost }: { onAuthLost: () => void }) {
  const list = useAdminData<{ available: boolean; tasks: TaskRow[]; counts?: Record<string, number>; reason?: string }>("/agents/tasks", undefined, onAuthLost);
  const [slug, setSlug] = useState("");
  const [task, setTask] = useState("");
  const [scopes, setScopes] = useState("");
  const [ladder, setLadder] = useState<string[]>(["ds-flash"]);
  const [isPublic, setIsPublic] = useState(false);
  const [priority, setPriority] = useState("0");
  const [msg, setMsg] = useState<string | null>(null);
  const fn = useCallback(async (body: Record<string, unknown>) => adminPost<{ task_id: number }>("/agents/tasks", body), []);
  const queue = useAction(fn, onAuthLost);

  function toggle(step: string) {
    setLadder((cur) => (cur.includes(step) ? cur.filter((s) => s !== step) : LADDER_STEPS.filter((s) => cur.includes(s) || s === step)));
  }

  async function go() {
    setMsg(null);
    const scopeList = scopes.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const res = await queue.run({ slug: slug.trim(), task: task.trim(), scopes: scopeList, ladder, public: isPublic, priority: Number(priority) || 0 });
    if (res) {
      setMsg(`تسک شمارهٔ ${res.task_id} در صف قرار گرفت.`);
      setTask("");
      list.reload();
    }
  }

  return (
    <>
      <Card title="افزودن تسک به صف ایجنت‌ها">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void go(); }}>
          <Field label="slug (حروف کوچک، عدد، خط تیره؛ ۳ تا ۴۰ نویسه)"><TextInput dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="fix-footer-links" maxLength={40} /></Field>
          <Field label="اولویت (‎-۱۰ تا ۱۰)"><TextInput dir="ltr" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value.replace(/[^\d-]/g, ""))} /></Field>
          <div className="sm:col-span-2"><Field label="متن تسک (فقط داخل فایل نوشته می‌شود، هیچ‌وقت به شل داده نمی‌شود)"><TextArea rows={5} value={task} onChange={(e) => setTask(e.target.value)} maxLength={8000} /></Field></div>
          <div className="sm:col-span-2"><Field label="پوشه‌های مجاز (scope)، هر خط یا با ویرگول یک مسیر نسبی" hint="مثلاً output_apps/enterprise_hub/frontend/src/app/admin"><TextArea dir="ltr" rows={2} value={scopes} onChange={(e) => setScopes(e.target.value)} /></Field></div>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-xs text-[var(--gh-muted)]">نردبان مدل (به ترتیب تلاش)</legend>
            <div className="flex flex-wrap gap-3">
              {LADDER_STEPS.map((s) => (
                <label key={s} className="flex min-h-9 items-center gap-2 text-sm">
                  <input type="checkbox" checked={ladder.includes(s)} onChange={() => toggle(s)} /> <span dir="ltr">{s}</span>
                </label>
              ))}
              <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> عمومی (مدل‌های رایگان مجازند)</label>
            </div>
            <p className="mt-1 text-[11px] text-[var(--gh-muted)]">مراحل best و free فقط برای تسک «عمومی» اجرا می‌شوند؛ strong وقتی TASKQ_STRONG_ALIAS روی سرور تنظیم باشد.</p>
          </fieldset>
          {queue.error && <div className="sm:col-span-2"><Notice tone="danger">{queue.error}</Notice></div>}
          {msg && <div className="sm:col-span-2"><Notice tone="ok">{msg}</Notice></div>}
          <div className="sm:col-span-2"><Btn type="submit" disabled={queue.busy || !/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug) || task.trim().length < 10 || ladder.length === 0}>افزودن به صف</Btn></div>
        </form>
      </Card>
      <Card title="تسک‌های اخیر" actions={<Btn small variant="ghost" onClick={list.reload}>بازخوانی</Btn>}>
        {list.loading && !list.data ? <Spinner /> : list.error && !list.data ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data?.available ? (
          <Notice tone="info">صف تسک‌ها در دسترس نیست (taskq.db مانت نشده یا هنوز ساخته نشده).</Notice>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-2">{Object.entries(list.data.counts ?? {}).map(([s, n]) => <Badge key={s} tone={STATUS_TONE[s] ?? "muted"}>{s}: {fa(n)}</Badge>)}</div>
            <TableWrap>
              <thead><tr><Th>#</Th><Th>slug</Th><Th>وضعیت</Th><Th>تلاش</Th><Th>آخرین تغییر</Th><Th>دلیل / شاخه</Th></tr></thead>
              <tbody>
                {list.data.tasks.map((t) => (
                  <tr key={t.id}>
                    <Td>{fa(t.id)}</Td><Td mono>{t.slug}</Td><Td><Badge tone={STATUS_TONE[t.status] ?? "muted"}>{t.status}</Badge></Td>
                    <Td>{fa(t.attempts)}</Td><Td>{when(t.updated)}</Td><Td mono className="max-w-[260px] break-words">{t.reason || t.branch || "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </>
        )}
      </Card>
    </>
  );
}

export function AgentsTab({ onAuthLost }: { onAuthLost: () => void }) {
  return (
    <div className="space-y-4">
      <ResearchBox onAuthLost={onAuthLost} />
      <SiteCheck onAuthLost={onAuthLost} />
      <TaskQueue onAuthLost={onAuthLost} />
    </div>
  );
}
