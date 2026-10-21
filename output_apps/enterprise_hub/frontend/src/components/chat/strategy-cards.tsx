"use client";
import React, { useState } from "react";
import Link from "next/link";
import { ChevronDown, Copy, Download, Printer, Scale, X } from "lucide-react";
import { buildDocx, downloadBlob, markdownToHtml, printHtml } from "@/lib/draft-markdown";
import {
  MAX_WHAT_HAPPENED,
  MIN_WHAT_HAPPENED,
  type ArbitrationClause,
  type StrategyIntake,
  type StrategyReport,
} from "@/lib/api/legal-strategy-client";
import { MarkdownView } from "./draft-cards";

/* ------------------------------- intake form ------------------------------- */

const EMPTY_INTAKE: StrategyIntake = {
  what_happened: "",
  counterparty: "",
  arbitration_clause: "unknown",
  amount: "",
  dates: "",
  notes: "",
};

const CLAUSE_OPTIONS: { value: ArbitrationClause; label: string }[] = [
  { value: "yes", label: "بله، شرط داوری دارد" },
  { value: "no", label: "خیر" },
  { value: "unknown", label: "نمی‌دانم / قراردادی نیست" },
];

export function StrategyIntakeForm(props: {
  busy: boolean;
  hasFiles: boolean;
  onSubmit: (intake: StrategyIntake) => void;
  onClose: () => void;
}) {
  const { busy, hasFiles, onSubmit, onClose } = props;
  const [form, setForm] = useState<StrategyIntake>(EMPTY_INTAKE);
  const set = <K extends keyof StrategyIntake>(key: K, value: StrategyIntake[K]) => setForm((f) => ({ ...f, [key]: value }));
  const len = form.what_happened.trim().length;
  const valid = len >= MIN_WHAT_HAPPENED;

  return (
    <section
      className="rounded-[14px] p-3 sm:p-4"
      style={{ background: "var(--ap-surface-2)", border: "1px solid var(--ap-line)" }}
      aria-label="فرم استراتژی حقوقی"
      data-testid="strategy-intake"
    >
      <div className="mb-2 flex items-center gap-2">
        <Scale className="size-4 ap-link" aria-hidden="true" />
        <h2 className="text-sm font-semibold">استراتژی حقوقی</h2>
        <button type="button" className="ap-chip ms-auto" onClick={onClose} aria-label="بستن فرم">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <p className="ap-notice mb-3">
        ماجرا را کوتاه بنویسید؛ همهٔ مسیرهای ممکن (کیفری، حقوقی/داوری، انتظامی و موارد دیگر) بررسی می‌شود.
        {hasFiles ? " پرونده‌های پیوست‌شده هم در تحلیل لحاظ می‌شوند." : ""}
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy) onSubmit({ ...form, what_happened: form.what_happened.trim() });
        }}
      >
        <label className="block text-[13px] font-semibold">
          چه اتفاقی افتاده است؟
          <textarea
            className="mt-1 w-full rounded-xl p-2 text-[15px] font-normal"
            style={{ background: "var(--ap-surface)", border: "1px solid var(--ap-line)", color: "inherit" }}
            rows={5}
            maxLength={MAX_WHAT_HAPPENED}
            value={form.what_happened}
            onChange={(e) => set("what_happened", e.target.value)}
            placeholder="مثال: وکیل من مبلغ محکوم‌به را از اجرای احکام دریافت کرد، به من خبر نداد و دیگر در دسترس نیست."
            required
          />
          <span className="ap-notice font-normal">حداقل {MIN_WHAT_HAPPENED} نویسه ({len} / {MAX_WHAT_HAPPENED})</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[13px] font-semibold">
            طرف مقابل کیست؟
            <input
              className="mt-1 w-full rounded-xl p-2 text-[15px] font-normal"
              style={{ background: "var(--ap-surface)", border: "1px solid var(--ap-line)", color: "inherit" }}
              maxLength={300}
              value={form.counterparty}
              onChange={(e) => set("counterparty", e.target.value)}
              placeholder="مثال: وکیل پرونده / شرکت / کارفرما"
            />
          </label>
          <label className="block text-[13px] font-semibold">
            آیا قرارداد دارای شرط داوری است؟
            <select
              className="mt-1 w-full rounded-xl p-2 text-[15px] font-normal"
              style={{ background: "var(--ap-surface)", border: "1px solid var(--ap-line)", color: "inherit" }}
              value={form.arbitration_clause}
              onChange={(e) => set("arbitration_clause", e.target.value as ArbitrationClause)}
            >
              {CLAUSE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[13px] font-semibold">
            مبلغ درگیر
            <input
              className="mt-1 w-full rounded-xl p-2 text-[15px] font-normal"
              style={{ background: "var(--ap-surface)", border: "1px solid var(--ap-line)", color: "inherit" }}
              maxLength={300}
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="مثال: ۴۰۰ میلیون تومان"
            />
          </label>
          <label className="block text-[13px] font-semibold">
            تاریخ‌های مهم
            <input
              className="mt-1 w-full rounded-xl p-2 text-[15px] font-normal"
              style={{ background: "var(--ap-surface)", border: "1px solid var(--ap-line)", color: "inherit" }}
              maxLength={300}
              value={form.dates}
              onChange={(e) => set("dates", e.target.value)}
              placeholder="مثال: دریافت وجه ۱۴۰۴/۰۵/۱۰"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="ap-chip ap-chip-link" disabled={!valid || busy}>
            <Scale className="size-4" aria-hidden="true" />
            <span>{busy ? "در حال بررسی مسیرها…" : "بررسی همهٔ مسیرها"}</span>
          </button>
          <span className="ap-notice">تحلیل ممکن است تا یک-دو دقیقه طول بکشد.</span>
        </div>
      </form>
    </section>
  );
}

/* ------------------------------ report renderer ----------------------------- */

/** Parse the `| a | b |` markdown table the server builds into header + rows. */
export function parseTable(md: string): { head: string[]; rows: string[][] } {
  const lines = md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
  const cells = (l: string) =>
    l
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  if (lines.length < 2) return { head: [], rows: [] };
  const body = lines.slice(1).filter((l) => !/^\|?\s*:?-{2,}/.test(l));
  return { head: cells(lines[0]), rows: body.map(cells) };
}

function TrackSection({ track, defaultOpen }: { track: StrategyReport["tracks"][number]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `strategy-track-${track.key}`;
  return (
    <div className="rounded-xl" style={{ background: "var(--ap-surface)", border: "1px solid var(--ap-line)" }} data-testid={`strategy-track-${track.key}`}>
      <button
        type="button"
        className="flex w-full items-center gap-2 p-3 text-start"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-[15px] font-semibold">{track.title}</span>
        {!track.grounded && (
          <span className="ap-notice" style={{ color: "var(--ap-warn)" }}>
            بدون مستند قانونی بازیابی‌شده
          </span>
        )}
        <ChevronDown className={`ms-auto size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} className="px-3 pb-3">
          {track.why && <p className="ap-notice mb-2">{track.why}</p>}
          <MarkdownView markdown={track.markdown} />
          {track.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 ps-5 text-[13px]" style={{ color: "var(--ap-warn)" }} role="note">
              {track.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {track.citations.length > 0 && (
            <div className="mt-2 text-[13px]">
              <span className="font-semibold">مستندات قانونی تأییدشده: </span>
              <span className="ap-muted">{track.citations.map((c) => `${c.law_name} ماده ${c.article_no}`).join("، ")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExtraBlock({ title, markdown }: { title: string; markdown: string }) {
  if (!markdown.trim()) return null;
  return (
    <div className="mt-3">
      <h3 className="mb-1 text-base font-semibold">{title}</h3>
      <MarkdownView markdown={markdown} />
    </div>
  );
}

export function StrategyReportCard({ report }: { report: StrategyReport }) {
  const [notice, setNotice] = useState("");
  const table = parseTable(report.comparison_table);
  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 4000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report.markdown);
      flash("متن گزارش کپی شد.");
    } catch {
      flash("کپی انجام نشد؛ متن را دستی انتخاب کنید.");
    }
  };

  return (
    <div className="mt-3 rounded-[14px] p-3" style={{ background: "var(--ap-surface-2)" }} data-testid="strategy-report-card">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: "var(--ap-warn)" }}>
          استراتژی حقوقی{report.case_domain ? ` — ${report.case_domain}` : ""}
        </span>
        {report.depth === "short" && <span className="ap-notice">نسخهٔ کوتاه (ارزان‌ترین مسیر)</span>}
      </div>

      {report.summary && (
        <div className="rounded-xl p-3" style={{ background: "var(--ap-surface)" }}>
          <h3 className="mb-1 text-base font-semibold">خلاصهٔ وضعیت</h3>
          <MarkdownView markdown={report.summary} />
        </div>
      )}

      {table.rows.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl" style={{ background: "var(--ap-surface)" }}>
          <table className="w-full min-w-[640px] border-collapse text-[13px] leading-6" dir="rtl">
            <thead>
              <tr>
                {table.head.map((h, i) => (
                  <th key={i} className="p-2 text-start font-semibold" style={{ borderBottom: "1px solid var(--ap-line)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="p-2 align-top" style={{ borderBottom: "1px solid var(--ap-line)" }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {report.tracks.map((t, i) => (
          <TrackSection key={t.key} track={t} defaultOpen={i === 0} />
        ))}
      </div>

      <ExtraBlock title="تعامل مسیرها" markdown={report.interactions} />
      <ExtraBlock title="ترتیب پیشنهادی" markdown={report.sequencing} />
      <ExtraBlock title="فهرست مدارک" markdown={report.checklist} />

      {report.missing_info.length > 0 && (
        <div className="mt-3 text-[13px]">
          <span className="font-semibold">اطلاعات لازم برای دقیق‌تر شدن: </span>
          <span className="ap-muted">{report.missing_info.join("؛ ")}</span>
        </div>
      )}

      {report.upsell && (
        <div className="mt-3 rounded-xl p-3 text-[13px]" style={{ background: "var(--ap-accent-soft)" }} data-testid="strategy-upsell">
          <p>{report.upsell.message}</p>
          {report.upsell.locked_tracks.length > 0 && (
            <p className="ap-muted mt-1">مسیرهای شناسایی‌شده در نسخهٔ کامل: {report.upsell.locked_tracks.join("، ")}</p>
          )}
          <Link href={report.upsell.plans_url} className="ap-link mt-1 inline-block underline">
            مشاهدهٔ اشتراک‌ها
          </Link>
        </div>
      )}

      {report.warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 ps-5 text-[13px]" style={{ color: "var(--ap-warn)" }} role="note">
          {report.warnings.slice(0, 8).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="ap-chip" onClick={() => void copy()}>
          <Copy className="size-4" aria-hidden="true" />
          <span>کپی</span>
        </button>
        <button
          type="button"
          className="ap-chip"
          onClick={() => {
            downloadBlob(buildDocx(report.markdown), "legal-strategy.docx");
            flash("فایل Word دانلود شد.");
          }}
        >
          <Download className="size-4" aria-hidden="true" />
          <span>دانلود Word</span>
        </button>
        <button
          type="button"
          className="ap-chip"
          onClick={() => {
            if (!printHtml(markdownToHtml(report.markdown, "استراتژی حقوقی"))) flash("پنجره چاپ مسدود شد؛ اجازه باز شدن پنجره را بدهید.");
          }}
        >
          <Printer className="size-4" aria-hidden="true" />
          <span>چاپ / PDF</span>
        </button>
      </div>
      {notice && (
        <p className="ap-notice mt-2" role="status">
          {notice}
        </p>
      )}
      <p className="ap-notice mt-2" role="note">
        {report.disclaimer}
      </p>
    </div>
  );
}
