"use client";
import React, { useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, FileText, Pencil, Printer, Sparkles, X } from "lucide-react";
import { DISCLAIMER_LINE } from "@/lib/chat-actions";
import type { DraftType } from "@/lib/chat-actions";
import type { Choice, CourtSuggestion, DraftFields, DraftResult, FieldMeta } from "@/lib/api/draft-assist-client";
import { buildDocx, downloadBlob, inlineSpans, markdownToHtml, parseMarkdown, printHtml } from "@/lib/draft-markdown";

/** State of the guided drafting conversation (lives in ChatShell). */
export interface DraftSession {
  type: DraftType;
  title: string;
  meta: FieldMeta[];
  /** Everything known so far (extracted + edited), as last returned by the server. */
  fields: DraftFields;
  /** Values the user typed or picked himself; sent back on every assist turn. */
  edits: DraftFields;
  sources: Record<string, string>;
  missing: { key: string; label: string; skippable: boolean }[];
  skipped: string[];
  choices: Choice[];
  courtOptions: Choice[];
  courtName: string;
  /** Rule-based competent-court suggestion with its legal basis (null when unknown). */
  courtSuggestion: CourtSuggestion | null;
  skipLabel: string;
  formUrl?: string | null;
  status: "collecting" | "ready" | "generating" | "done";
}

function asText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join("\n");
  return value ?? "";
}

function displayValue(session: DraftSession, meta: FieldMeta): string {
  if (meta.key === "court_type") return session.courtName || "";
  return asText(session.fields[meta.key]);
}

/* ------------------------------- info card -------------------------------- */

export function DraftInfoCard(props: {
  session: DraftSession;
  busy: boolean;
  onEdit: (key: string, value: string) => void;
  onConfirmCourt: (courtKey: string) => void;
  onGenerate: () => void;
  onExit: () => void;
}) {
  const { session, busy, onEdit, onConfirmCourt, onGenerate, onExit } = props;
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(true);
  const missingKeys = new Set(session.missing.map((m) => m.key));
  // Show the chip only while the court in the card is still the unconfirmed suggestion.
  const suggestion = session.courtSuggestion;
  const showCourtChip =
    !!suggestion && !session.edits.court_type && session.fields.court_type === suggestion.court_key;

  const startEdit = (meta: FieldMeta) => {
    setEditing(meta.key);
    setValue(meta.key === "court_type" ? asText(session.fields.court_type) : asText(session.fields[meta.key]));
  };
  const commit = () => {
    if (editing) onEdit(editing, value);
    setEditing(null);
  };

  return (
    <section className="ap-card" aria-label="اطلاعات پرونده" data-testid="draft-info-card">
      <div className="flex items-center gap-2">
        <FileText className="size-4" aria-hidden="true" />
        <h2 className="text-[15px] font-semibold">اطلاعات پرونده — {session.title}</h2>
        <button type="button" className="ap-link ms-auto text-[13px] underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "جمع کردن" : "نمایش"}
        </button>
        <button type="button" className="ap-iconbtn" onClick={onExit} aria-label="خروج از حالت تنظیم پیش‌نویس" title="خروج از حالت تنظیم پیش‌نویس">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {open && (
        <>
          <p className="ap-notice mt-1">روی هر مورد بزنید تا اصلاح شود. موارد ستاره‌دار برای تنظیم پیش‌نویس لازم‌اند.</p>
          {showCourtChip && suggestion && (
            <div className="ap-notice mt-2 flex flex-wrap items-center gap-2" data-testid="court-suggestion-chip">
              <span>
                {suggestion.chip_text ??
                  `دادگاه پیشنهادی: ${suggestion.court}${suggestion.basis_article ? ` (بر اساس ${suggestion.basis_article})` : ""} — درست است؟`}
              </span>
              <button type="button" className="ap-chip" disabled={busy} onClick={() => onConfirmCourt(suggestion.court_key)}>
                <Check className="size-4" aria-hidden="true" />
                <span>درست است</span>
              </button>
              <button
                type="button"
                className="ap-chip"
                onClick={() => {
                  const meta = session.meta.find((m) => m.key === "court_type");
                  if (meta) startEdit(meta);
                }}
              >
                <Pencil className="size-4" aria-hidden="true" />
                <span>تغییر</span>
              </button>
            </div>
          )}
          <ul className="mt-2 space-y-1.5">
            {session.meta.map((meta) => {
              const shown = displayValue(session, meta);
              const skipped = session.skipped.includes(meta.key) && !shown;
              const isMissing = missingKeys.has(meta.key);
              return (
                <li key={meta.key} className="rounded-xl px-3 py-2" style={{ background: "var(--ap-surface-2)" }}>
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="font-semibold">
                      {meta.label}
                      {meta.required && <span aria-hidden="true"> *</span>}
                    </span>
                    {session.sources[meta.key] === "suggested" && shown && (
                      <span className="ap-muted">(پیشنهادی؛ قابل ویرایش)</span>
                    )}
                    {editing !== meta.key && (
                      <button
                        type="button"
                        className="ap-link ms-auto inline-flex items-center gap-1 underline"
                        onClick={() => startEdit(meta)}
                        aria-label={`ویرایش ${meta.label}`}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                        <span>{shown ? "ویرایش" : "افزودن"}</span>
                      </button>
                    )}
                  </div>
                  {editing === meta.key ? (
                    <div className="mt-1.5 flex flex-col gap-2">
                      {meta.key === "court_type" ? (
                        <select
                          className="rounded-lg border px-2 py-1.5"
                          style={{ background: "var(--ap-surface)", borderColor: "var(--ap-line)", color: "var(--ap-text)" }}
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                          aria-label={meta.label}
                        >
                          <option value="">— انتخاب کنید —</option>
                          {session.courtOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <textarea
                          className="w-full rounded-lg border px-2 py-1.5"
                          style={{ background: "var(--ap-surface)", borderColor: "var(--ap-line)", color: "var(--ap-text)" }}
                          rows={meta.kind === "short" ? 1 : 4}
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                          aria-label={meta.label}
                          placeholder={meta.kind === "list" ? "هر مورد در یک خط" : undefined}
                          autoFocus
                        />
                      )}
                      <div className="flex gap-2">
                        <button type="button" className="ap-chip" onClick={commit}>
                          <Check className="size-4" aria-hidden="true" />
                          <span>ثبت</span>
                        </button>
                        <button type="button" className="ap-chip" onClick={() => setEditing(null)}>
                          <span>انصراف</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p
                      className="mt-0.5 whitespace-pre-line break-words text-[14px]"
                      dir="auto"
                      style={isMissing && !skipped ? { color: "var(--ap-warn)" } : undefined}
                    >
                      {shown || (skipped ? "بعداً تکمیل می‌شود (جای خالی در متن)" : isMissing ? "نیاز است" : "—")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {session.status !== "done" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className="ap-btn" disabled={busy || session.missing.length > 0} onClick={onGenerate}>
                <Sparkles className="size-4" aria-hidden="true" />
                <span>{session.status === "generating" ? "در حال تنظیم…" : "تنظیم پیش‌نویس"}</span>
              </button>
              {session.missing.length > 0 && (
                <span className="ap-notice">
                  {session.missing.length.toLocaleString("fa-IR")} مورد لازم باقی مانده است
                </span>
              )}
            </div>
          )}
          {session.formUrl && (
            <p className="mt-2 text-[13px]">
              <Link href={session.formUrl} className="ap-link underline">
                حالت پیشرفته (فرم)
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------ markdown view ------------------------------ */

export function MarkdownView({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown);
  const spans = (text: string) =>
    inlineSpans(text).map((s, i) => (s.bold ? <strong key={i}>{s.text}</strong> : <React.Fragment key={i}>{s.text}</React.Fragment>));
  return (
    <div className="space-y-1.5 text-[15px] leading-8" dir="rtl">
      {blocks.map((b, i) => {
        if (b.kind === "h") {
          const cls = b.level === 1 ? "text-lg font-bold" : "text-base font-semibold";
          return (
            <h3 key={i} className={`${cls} mt-3`}>
              {spans(b.text)}
            </h3>
          );
        }
        if (b.kind === "li") return <p key={i} className="ps-4">• {spans(b.text)}</p>;
        if (b.kind === "quote") {
          return (
            <p key={i} className="ap-notice border-s-2 ps-3" style={{ borderColor: "var(--ap-line)" }}>
              {spans(b.text)}
            </p>
          );
        }
        return <p key={i}>{spans(b.text)}</p>;
      })}
    </div>
  );
}

/* ------------------------------- result card ------------------------------- */

export function DraftResultCard(props: { result: DraftResult; busy: boolean; onRevise: () => void }) {
  const { result, busy, onRevise } = props;
  const [notice, setNotice] = useState("");
  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 4000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.draft_markdown);
      flash("متن پیش‌نویس کپی شد.");
    } catch {
      flash("کپی انجام نشد؛ متن را دستی انتخاب کنید.");
    }
  };
  const docx = () => {
    downloadBlob(buildDocx(result.draft_markdown), `${result.title.replace(/\s+/g, "-")}.docx`);
    flash("فایل Word دانلود شد.");
  };
  const print = () => {
    if (!printHtml(markdownToHtml(result.draft_markdown, result.title))) {
      flash("پنجره چاپ مسدود شد؛ اجازه باز شدن پنجره را بدهید.");
    }
  };

  return (
    <div className="mt-3 rounded-[14px] p-3" style={{ background: "var(--ap-surface-2)" }} data-testid="draft-result-card">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: "var(--ap-warn)" }}>
          پیش‌نویس غیررسمی — {result.title}
        </span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto rounded-xl p-3" style={{ background: "var(--ap-surface)" }}>
        <MarkdownView markdown={result.draft_markdown} />
      </div>

      {result.warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 ps-5 text-[13px]" style={{ color: "var(--ap-warn)" }} role="note">
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {result.citations.length > 0 && (
        <div className="mt-2 text-[13px]">
          <span className="font-semibold">مستندات قانونی تأییدشده: </span>
          <span className="ap-muted">{result.citations.map((c) => `${c.law_name} ماده ${c.article_no}`).join("، ")}</span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="ap-chip" onClick={() => void copy()}>
          <Copy className="size-4" aria-hidden="true" />
          <span>کپی</span>
        </button>
        <button type="button" className="ap-chip" onClick={docx}>
          <Download className="size-4" aria-hidden="true" />
          <span>دانلود Word</span>
        </button>
        <button type="button" className="ap-chip" onClick={print}>
          <Printer className="size-4" aria-hidden="true" />
          <span>چاپ / PDF</span>
        </button>
        <button type="button" className="ap-chip ap-chip-link" onClick={onRevise} disabled={busy}>
          <Pencil className="size-4" aria-hidden="true" />
          <span>اصلاح کن</span>
        </button>
      </div>
      {notice && (
        <p className="ap-notice mt-2" role="status">
          {notice}
        </p>
      )}
      <p className="ap-notice mt-2" role="note">
        {result.disclaimer ?? DISCLAIMER_LINE}
      </p>
    </div>
  );
}
