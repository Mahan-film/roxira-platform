"use client";

import { useCallback, useState } from "react";
import {
  BookOpenCheck,
  Check,
  CheckCircle2,
  Coins,
  Copy,
  FileSearch,
  FileStack,
  FileWarning,
  Gauge,
  Gavel,
  Landmark,
  ListChecks,
  Printer,
  ScrollText,
  Scale,
  TrendingUp,
} from "lucide-react";

import type { ChatResult } from "@/components/chat/types";
import { LegalReferenceHighlight } from "@/components/chat/legal-reference-highlight";
import { formatRial } from "@/lib/format";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** متن قانونی قابل کپی/چاپ را از نتیجه ساختاریافته استخراج می‌کند. */
function buildLegalText(result: ChatResult): { title: string; body: string } | null {
  if (result.kind === "analysis") {
    const body = result.data.draft_text?.trim() || result.data.legal_advisory?.trim();
    return body ? { title: "تحلیل حقوقی پرونده و پیش‌نویس لایحه", body } : null;
  }
  if (result.kind === "retrial") {
    const body = result.data.petition_text?.trim() || result.data.eligibility_analysis?.trim();
    return body
      ? { title: result.data.retrial_label || "دادخواست رسمی اعاده دادرسی", body }
      : null;
  }
  if (result.kind === "strategy") {
    const data = result.data;
    const parts: string[] = [];
    if (data.evidence_analysis?.trim()) {
      parts.push(`【تبیین ادله و شانس موفقیت】\n${data.evidence_analysis.trim()}`);
    }
    if (data.success_probability?.trim()) {
      parts.push(`ارزیابی شانس موفقیت: ${data.success_probability.trim()}`);
    }
    if (data.statutory_basis.length) {
      parts.push(
        `【مواد قانونی استنادی】\n${data.statutory_basis
          .map((law, index) => `${index + 1}. ${law.title}${law.category ? ` (${law.category})` : ""}\n${law.text}`)
          .join("\n\n")}`,
      );
    }
    if (data.unified_precedents.length) {
      parts.push(
        `【آرای وحدت رویه حاکم】\n${data.unified_precedents
          .map((precedent, index) => `${index + 1}. ${precedent.title}\n${precedent.summary}`)
          .join("\n\n")}`,
      );
    }
    if (data.defense_draft?.trim()) {
      parts.push(`【پیش‌نویس لایحه دفاعیه】\n${data.defense_draft.trim()}`);
    }
    const body = parts.join("\n\n").trim();
    return body ? { title: "استراتژی حقوقی و پیش‌نویس لایحه دفاعیه", body } : null;
  }
  return null;
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
    } catch (error) {
      reject(error);
    } finally {
      document.body.removeChild(textarea);
    }
  });
}

/** باز کردن پنجره چاپ با خروجی رسمی و فارسی‌خوان (RTL) برای ذخیره PDF. */
function printLegalDocument(title: string, body: string): void {
  const win = window.open("", "_blank", "noopener,noreferrer,width=860,height=1000");
  if (!win) return;
  win.document.write(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "Vazirmatn", "Tahoma", system-ui, sans-serif; color: #111827; line-height: 2; margin: 0; }
  header { border-bottom: 2px solid #b45309; padding-bottom: 12px; margin-bottom: 20px; }
  h1 { font-size: 18px; margin: 0 0 6px; color: #92400e; }
  .meta { font-size: 11px; color: #6b7280; }
  pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 13px; margin: 0; }
  footer { margin-top: 28px; border-top: 1px solid #e5e7eb; padding-top: 10px; font-size: 10px; color: #6b7280; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">سامانه قاضی هوشمند — ghazihoushmand.ir</div>
  </header>
  <pre>${escapeHtml(body)}</pre>
  <footer>این سند توسط دستیار حقوقی هوشمند تولید شده است و جایگزین مشاوره رسمی وکیل نیست.</footer>
</body>
</html>`);
  win.document.close();
  win.focus();
  win.print();
}

function LegalExportActions({ result }: { result: ChatResult }) {
  const payload = buildLegalText(result);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!payload) return;
    try {
      await copyToClipboard(`${payload.title}\n\n${payload.body}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [payload]);

  const handlePrint = useCallback(() => {
    if (!payload) return;
    printLegalDocument(payload.title, payload.body);
  }, [payload]);

  if (!payload) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-white/8 pt-3">
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-slate-300 transition-colors hover:border-amber-400/40 hover:bg-amber-400/10 hover:text-amber-100"
      >
        {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
        {copied ? "کپی شد" : "کپی متن لایحه"}
      </button>
      <button
        type="button"
        onClick={handlePrint}
        className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-slate-300 transition-colors hover:border-amber-400/40 hover:bg-amber-400/10 hover:text-amber-100"
      >
        <Printer className="size-3.5" />
        چاپ / خروجی رسمی
      </button>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-2 text-[13px] font-bold text-amber-200/90">
        {icon}
        {title}
      </h4>
      {children}
    </section>
  );
}

function scoreTone(score: number) {
  if (score >= 70) return { bar: "bg-emerald-400", text: "text-emerald-300" };
  if (score >= 40) return { bar: "bg-amber-400", text: "text-amber-300" };
  return { bar: "bg-rose-400", text: "text-rose-300" };
}

/** رندر نتیجه ساختاریافته درون حباب گفتگو — بدون اصطلاحات فنی مهندسی. */
export function ChatResultView({ result }: { result: ChatResult }) {
  if (result.kind === "analysis") {
    const data = result.data;
    return (
      <div className="space-y-4">
        <Section icon={<Scale className="size-4" />} title="تحلیل حقوقی پرونده">
          {data.success_probability && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
              <TrendingUp className="size-3" />
              ارزیابی شانس موفقیت: {data.success_probability}
            </span>
          )}
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-200">
            {data.legal_advisory}
          </p>
        </Section>

        {data.matched_laws.length > 0 && (
          <Section
            icon={<BookOpenCheck className="size-4" />}
            title={`مبنای قانونی (${data.matched_laws.length} مورد)`}
          >
            <div className="space-y-2">
              {data.matched_laws.map((law, index) => (
                <div
                  key={`${law.title}-${index}`}
                  className="rounded-xl border border-white/8 bg-white/[0.03] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-slate-100">{law.title}</span>
                    <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                      {law.category}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{law.text}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {data.draft_text && (
          <Section icon={<ScrollText className="size-4" />} title="پیش‌نویس لایحه">
            <div className="max-h-72 overflow-auto rounded-xl border border-white/8 bg-black/30 p-3">
              <LegalReferenceHighlight
                text={data.draft_text}
                laws={data.matched_laws}
                precedents={data.cited_precedents.map(title => ({ title }))}
                className="text-[12px] leading-relaxed text-slate-200"
              />
            </div>
          </Section>
        )}

        {data.cited_precedents.length > 0 && (
          <Section icon={<Landmark className="size-4" />} title="رویه قضایی استنادی">
            <div className="flex flex-wrap gap-1.5">
              {data.cited_precedents.map((precedent, index) => (
                <span
                  key={`${precedent}-${index}`}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300"
                >
                  {precedent}
                </span>
              ))}
            </div>
          </Section>
        )}

        <LegalExportActions result={result} />
      </div>
    );
  }

  if (result.kind === "retrial") {
    const data = result.data;
    const tone = scoreTone(data.eligibility_score);
    return (
      <div className="space-y-4">
        <Section icon={<Gauge className="size-4" />} title="سنجش شانس پذیرش اعاده دادرسی">
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="flex items-end justify-between">
              <span className={`text-3xl font-black ${tone.text}`}>
                {data.eligibility_score}
                <span className="text-base">٪</span>
              </span>
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                {data.retrial_label}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all ${tone.bar}`}
                style={{ width: `${data.eligibility_score}%` }}
              />
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              سهمیه رایگان باقی‌مانده: {data.quota.remaining} از {data.quota.free_quota}
            </p>
          </div>
          {data.eligibility_analysis && (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-200">
              {data.eligibility_analysis}
            </p>
          )}
        </Section>

        {data.missing_requirements.length > 0 && (
          <Section icon={<ListChecks className="size-4" />} title="الزامات تکمیلی پرونده">
            <ul className="list-inside list-disc space-y-1 text-[12px] text-slate-300">
              {data.missing_requirements.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </Section>
        )}

        {data.petition_text && (
          <Section icon={<CheckCircle2 className="size-4" />} title="دادخواست رسمی اعاده دادرسی">
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-white/8 bg-black/30 p-3 text-[12px] leading-relaxed text-slate-200">
              {data.petition_text}
            </pre>
          </Section>
        )}

        {data.statutory_grounds.length > 0 && (
          <Section icon={<FileWarning className="size-4" />} title="جهات قانونی احصاشده">
            <ul className="list-inside list-disc space-y-1 text-[11px] text-slate-400">
              {data.statutory_grounds.map((ground, index) => (
                <li key={`${ground}-${index}`}>{ground}</li>
              ))}
            </ul>
          </Section>
        )}

        <LegalExportActions result={result} />
      </div>
    );
  }

  if (result.kind === "strategy") {
    const data = result.data;
    return (
      <div className="space-y-4">
        <Section icon={<Gavel className="size-4" />} title="استراتژی حقوقی پرونده">
          {data.success_probability && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
              <TrendingUp className="size-3" />
              ارزیابی شانس موفقیت: {data.success_probability}
            </span>
          )}
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-200">
            {data.evidence_analysis}
          </p>
        </Section>

        {data.statutory_basis.length > 0 && (
          <Section
            icon={<BookOpenCheck className="size-4" />}
            title={`مواد قانونی استنادی (${data.statutory_basis.length} مورد)`}
          >
            <div className="space-y-2">
              {data.statutory_basis.map((law, index) => (
                <div
                  key={`${law.title}-${index}`}
                  className="rounded-xl border border-white/8 bg-white/[0.03] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-slate-100">{law.title}</span>
                    <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                      {law.category}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{law.text}</p>
                  {law.relevance && (
                    <p className="mt-1 text-[10px] text-amber-200/70">{law.relevance}</p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {data.unified_precedents.length > 0 && (
          <Section icon={<Landmark className="size-4" />} title="آرای وحدت رویه حاکم">
            <div className="space-y-2">
              {data.unified_precedents.map((precedent, index) => (
                <div
                  key={`${precedent.title}-${index}`}
                  className="rounded-xl border border-white/8 bg-white/[0.03] p-3"
                >
                  <span className="text-[12px] font-semibold text-slate-100">{precedent.title}</span>
                  {precedent.summary && (
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                      {precedent.summary}
                    </p>
                  )}
                  {precedent.binding_effect && (
                    <p className="mt-1 text-[10px] text-amber-200/70">{precedent.binding_effect}</p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {data.defense_draft && (
          <Section icon={<ScrollText className="size-4" />} title="پیش‌نویس لایحه دفاعیه">
            <div className="max-h-80 overflow-auto rounded-xl border border-white/8 bg-black/30 p-3">
              <LegalReferenceHighlight
                text={data.defense_draft}
                laws={data.statutory_basis}
                precedents={data.unified_precedents}
                className="text-[12px] leading-relaxed text-slate-200"
              />
            </div>
          </Section>
        )}

        {data.source_documents.length > 0 && (
          <Section icon={<FileStack className="size-4" />} title="اسناد پردازش‌شده">
            <div className="flex flex-wrap gap-1.5">
              {data.source_documents.map((doc, index) => (
                <span
                  key={`${doc.filename}-${index}`}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300"
                >
                  <FileSearch className="size-3" />
                  {doc.filename}
                  <span className="text-slate-500">
                    ({doc.format}
                    {doc.ocr_used ? " · OCR" : ""})
                  </span>
                </span>
              ))}
            </div>
          </Section>
        )}

        <LegalExportActions result={result} />
      </div>
    );
  }

  const data = result.data;
  return (
    <div className="space-y-4">
      <Section icon={<Coins className="size-4" />} title="محاسبه خسارت تاخیر تادیه">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="text-[10px] text-slate-500">اصل مبلغ</div>
            <div className="mt-1 text-[12px] font-bold text-slate-100">
              {formatRial(data.principal_amount)}
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="text-[10px] text-slate-500">ارزش به‌روزشده</div>
            <div className="mt-1 text-[12px] font-bold text-slate-100">
              {formatRial(data.updated_value_to_date)}
            </div>
          </div>
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-3">
            <div className="text-[10px] text-amber-200/80">خسارت تاخیر تادیه</div>
            <div className="mt-1 text-[12px] font-bold text-amber-200">
              {formatRial(data.total_delay_damages)}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-slate-500">
          بازه {data.start_year} تا {data.end_year} — شاخص {data.start_index} به {data.end_index}
        </p>
      </Section>

      <Section icon={<Landmark className="size-4" />} title="مبنای قانونی">
        <p className="text-[11px] leading-relaxed text-slate-400">{data.legal_basis}</p>
        <p className="text-[10px] text-slate-500">{data.index_source}</p>
      </Section>
    </div>
  );
}
