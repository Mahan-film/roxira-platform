"use client";

import { useState } from "react";
import { AlertTriangle, Copy, Download, Printer, ShieldAlert } from "lucide-react";

import type { IndictmentDraftResponse, IndictmentLegalBasis } from "@/lib/api/smart-judge-client";

function basisLine(x: IndictmentLegalBasis): string {
  return `${x.law_name} ماده ${x.article_no}${x.reasoning ? ` — ${x.reasoning}` : ""}`;
}

/** متن کامل قابل کپی/دانلود؛ بنر غیرقطعی همیشه در ابتدا قرار می‌گیرد. */
export function buildIndictmentText(r: IndictmentDraftResponse): string {
  const s = r;
  const lines: string[] = [
    r.banner,
    "",
    r.status === "AI_DRAFT_UNVERIFIED" ? "وضعیت: پیش‌نویس تأییدنشده" : "وضعیت: مبنای ناکافی",
    "",
    "شرح اتهام",
    s.charge_description,
    "",
    "خلاصه ادله",
    s.evidence_summary,
    "",
  ];
  if (s.legal_basis.length) {
    lines.push("مبانی قانونی");
    s.legal_basis.forEach((x) => lines.push(`- ${basisLine(x)}`));
    lines.push("");
  }
  if (r.removed_citations.length) {
    lines.push("استنادهای حذف‌شده (تأییدنشده)");
    r.removed_citations.forEach((x) => lines.push(`- ${x}`));
    lines.push("");
  }
  if (s.missing_information.length) {
    lines.push("اطلاعات ناقص");
    s.missing_information.forEach((x) => lines.push(`- ${x}`));
    lines.push("");
  }
  lines.push(r.disclaimer, "", `draft_id: ${r.draft_id}`, `sha256: ${r.content_sha256}`);
  return lines.join("\n");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ap-card">
      <h3 className="mb-3 text-xl font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? (
    <ul className="list-disc space-y-1 ps-5">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  ) : (
    <p className="ap-muted">{empty}</p>
  );
}

export function IndictmentResultView({ result }: { result: IndictmentDraftResponse }) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const insufficient = result.status === "INSUFFICIENT_BASIS";
  const s = result;
  const text = () => buildIndictmentText(result);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text());
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied(null), 3000);
  }

  function download() {
    const blob = new Blob([text()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `draft-indictment-${result.draft_id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* بنر غیرقطعی: همیشه اولین عنصر نتیجه است، حتی در حالت مبنای ناکافی */}
      <div
        role="note"
        data-testid="non-binding-banner"
        className="flex gap-3 rounded-[18px] p-5 text-lg font-semibold"
        style={{ border: "2px solid var(--ap-warn)", color: "var(--ap-warn)", background: "var(--ap-surface)" }}
      >
        <ShieldAlert className="mt-1 size-6 shrink-0" aria-hidden="true" />
        <p>{result.banner}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          data-testid="status-chip"
          className="inline-flex min-h-11 items-center gap-2 rounded-[980px] px-5 font-medium"
          style={{
            background: "var(--ap-surface)",
            border: `1px solid ${insufficient ? "var(--ap-danger)" : "var(--ap-warn)"}`,
          }}
        >
          <AlertTriangle className="size-4" aria-hidden="true" />
          {insufficient ? "مبنای ناکافی" : "پیش‌نویس تأییدنشده"}
        </span>
        <div className="no-print flex flex-wrap gap-2">
          <button type="button" className="ap-btn ap-btn-ghost" onClick={copy}>
            <Copy className="size-4" aria-hidden="true" />
            کپی متن
          </button>
          <button type="button" className="ap-btn ap-btn-ghost" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            نسخه چاپی
          </button>
          <button type="button" className="ap-btn ap-btn-ghost" onClick={download}>
            <Download className="size-4" aria-hidden="true" />
            دانلود txt
          </button>
        </div>
      </div>
      <p role="status" className="ap-muted no-print min-h-6 text-sm">
        {copied === "ok" ? "متن کپی شد." : copied === "fail" ? "کپی انجام نشد؛ متن را دستی انتخاب کنید." : ""}
      </p>

      <Section title="شرح اتهام">
        {s.charge_description ? (
          <p className="whitespace-pre-wrap">{s.charge_description}</p>
        ) : (
          <p className="ap-muted">به دلیل ناکافی بودن مبنا، شرح اتهامی پیشنهاد نشد.</p>
        )}
      </Section>
      <Section title="خلاصه ادله">
        {s.evidence_summary ? (
          <p className="whitespace-pre-wrap">{s.evidence_summary}</p>
        ) : (
          <p className="ap-muted">خلاصه‌ای از ادله موجود نیست.</p>
        )}
      </Section>

      <div className="grid gap-4 md:grid-cols-3">
        <Section title="مبانی قانونی">
          <List items={s.legal_basis.map(basisLine)} empty="مبنای قانونی تأییدشده‌ای وجود ندارد." />
        </Section>
        <Section title="استنادهای حذف‌شده">
          <p className="ap-muted mb-2 text-sm">این موارد راستی‌آزمایی نشدند و در پیش‌نویس به کار نرفتند.</p>
          <List items={result.removed_citations} empty="موردی حذف نشد." />
        </Section>
        <Section title="اطلاعات ناقص">
          <List items={s.missing_information} empty="مورد ناقصی گزارش نشد." />
        </Section>
      </div>

      <Section title="سلب مسئولیت">
        <p className="ap-muted">{result.disclaimer}</p>
        <p className="ap-muted mt-3 break-all text-sm" dir="ltr">
          {result.draft_id} · {result.content_sha256}
        </p>
      </Section>
    </div>
  );
}
