"use client";

import { useEffect, useState } from "react";
import { Check, Copy, FileText, Loader2, Printer, X } from "lucide-react";

const DRAFTS_ENDPOINT = "/api/v1/apps/judge/drafts/template";

type DraftTemplateType = "DADKHAST" | "SHEKAYAT" | "LAYEHE_DEFEE";

interface DraftSection {
  key: string;
  label: string;
  required: boolean;
  hint: string;
  value: string | null;
  filled: boolean;
}

interface DraftTemplateResponse {
  status: string;
  template_type: DraftTemplateType;
  title: string;
  authority: string;
  court_branch?: string | null;
  case_number?: string | null;
  statutory_basis: string[];
  sections: DraftSection[];
  required_fields: string[];
  missing_required_fields: string[];
  ready_to_file: boolean;
  filing_checklist: string[];
  rendered_text: string;
  warnings: string[];
  message?: string;
}

const TEMPLATE_OPTIONS: { id: DraftTemplateType; label: string; hint: string }[] = [
  { id: "DADKHAST", label: "دادخواست حقوقی", hint: "خواهان / خوانده / خواسته / دلایل" },
  { id: "SHEKAYAT", label: "شکواییه کیفری", hint: "شاکی / مشتکی‌عنه / موضوع جرم / دلایل" },
  { id: "LAYEHE_DEFEE", label: "لایحه دفاعیه", hint: "مقدمه / دفاع شکلی و ماهوی / تقاضا" },
];

/** Local fallback section metadata used when the drafts API is unreachable. */
const FALLBACK_SECTIONS: Record<DraftTemplateType, { key: string; label: string; required: boolean }[]> = {
  DADKHAST: [
    { key: "khahan", label: "خواهان", required: true },
    { key: "khankhah", label: "خوانده", required: true },
    { key: "khastah", label: "موضوع / خواسته", required: true },
    { key: "dalayel", label: "دلایل و منضمات", required: true },
    { key: "emza", label: "امضا و تاریخ", required: false },
  ],
  SHEKAYAT: [
    { key: "shaki", label: "شاکی", required: true },
    { key: "moshtaki_alaih", label: "مشتکی‌عنه", required: true },
    { key: "mozoo_jaram", label: "موضوع", required: true },
    { key: "dalayel", label: "دلایل", required: true },
    { key: "emza", label: "امضا و تاریخ", required: false },
  ],
  LAYEHE_DEFEE: [
    { key: "moghaddame", label: "مقدمه", required: true },
    { key: "defa_shakli", label: "دفاع شکلی", required: true },
    { key: "defa_mahavi", label: "دفاع ماهوی", required: true },
    { key: "taghaza_rad", label: "موضوع / تقاضا", required: true },
    { key: "emza", label: "امضا و تاریخ", required: false },
  ],
};

const FALLBACK_TITLES: Record<DraftTemplateType, string> = {
  DADKHAST: "دادخواست حقوقی",
  SHEKAYAT: "شکواییه کیفری",
  LAYEHE_DEFEE: "لایحه دفاعیه",
};

interface DraftPreset {
  id: string;
  label: string;
  templateType: DraftTemplateType;
  subject: string;
  facts: string;
  requestedVerdict: string;
}

/** Quick-fill presets for common disputes (populate facts + requested_verdict). */
const DRAFT_PRESETS: DraftPreset[] = [
  {
    id: "sayad-cheque",
    label: "مطالبه وجه چک صیادی (ماده ۲۳)",
    templateType: "DADKHAST",
    subject: "مطالبه وجه چک صیادی",
    facts:
      "این جانب دارنده چک صیادی شماره ....... مورخ ....... به مبلغ ....... ریال هستم که در سامانه صیاد ثبت شده و توسط خوانده صادر گردیده است. پس از مراجعه به بانک، گواهی عدم پرداخت به دلیل کسری موجودی صادر شد و خوانده با وجود مطالبات مکرر از پرداخت وجه امتناع کرده است.",
    requestedVerdict:
      "صدور اجراییه برای وصول وجه چک صیادی به همراه خسارت تأخیر تأدیه از تاریخ سررسید تا زمان اجرای کامل حکم، مطابق ماده ۲۳ قانون صدور چک.",
  },
  {
    id: "official-deed",
    label: "الزام به تنظیم سند رسمی ملک (ماده ۲۲ و ۴۸ ثبت)",
    templateType: "DADKHAST",
    subject: "الزام به تنظیم سند رسمی انتقال",
    facts:
      "به موجب مبایعه‌نامه شماره ....... مورخ .......، ملک موضوع پلاک ثبتی ....... واقع در ....... به این جانب فروخته شد و ثمن معامله به‌طور کامل پرداخت گردید؛ اما خوانده از حضور در دفتر اسناد رسمی برای تنظیم و امضای سند رسمی انتقال خودداری می‌کند.",
    requestedVerdict:
      "الزام خوانده به تنظیم سند رسمی انتقال پلاک ثبتی ....... به نام این جانب و در صورت امتناع، تنظیم سند از طریق دفتر اسناد رسمی با استناد به مواد ۲۲ و ۴۸ قانون ثبت اسناد و املاک.",
  },
  {
    id: "lease-eviction",
    label: "تخلیه ید به دلیل انقضای مدت اجاره (قانون روابط موجر و مستاجر ۱۳۷۶)",
    templateType: "DADKHAST",
    subject: "تخلیه ید و تحویل عین مستأجره",
    facts:
      "ملک مورد اجاره به موجب قرارداد شماره ....... مورخ ....... برای مدت ....... به خوانده واگذار گردید. مدت اجاره منقضی شده و علی‌رغم اخطار کتبی، خوانده از تخلیه و تحویل ملک خودداری می‌کند.",
    requestedVerdict:
      "صدور حکم بر تخلیه ید و تحویل عین مستأجره و مطالبه اجرت‌المثل ایام تصرف، به استناد قانون روابط موجر و مستاجر مصوب ۱۳۷۶.",
  },
];

export interface DraftBuilderDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface DraftPrintMeta {
  caseNumber: string;
  courtBranch: string;
  plaintiff: string;
  defendant: string;
}

function printDraft(title: string, body: string, meta: DraftPrintMeta): void {
  const win = window.open("", "_blank", "noopener,noreferrer,width=860,height=1000");
  if (!win) return;
  win.document.write(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  /* Official single-page A4 layout — Iran judiciary document typography. */
  @page { size: A4 portrait; margin: 2cm; }
  html, body { margin: 0; padding: 0; }
  * { box-sizing: border-box; page-break-inside: avoid; break-inside: avoid; }
  body {
    font-family: "Vazirmatn", "Shabnam", "B Nazanin", "Tahoma", sans-serif;
    color: #000;
    font-size: 13pt;
    line-height: 1.6;
    text-align: justify;
    text-justify: inter-word;
    direction: rtl;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .doc { width: 100%; max-height: 257mm; overflow: hidden; }
  /* Distinct bordered metadata box for case number, branch and parties. */
  .meta {
    border: 1.5px solid #000;
    border-radius: 0;
    padding: 3mm;
    margin: 0 0 5mm;
  }
  .meta table { width: 100%; border-collapse: collapse; font-size: 11pt; line-height: 1.6; }
  .meta th, .meta td { border: 1px solid #000; padding: 1.5mm 2.5mm; vertical-align: top; }
  .meta th { background: #f1f5f9; font-weight: 700; width: 22%; text-align: right; }
  .doc h1 {
    font-size: 15pt;
    font-weight: 700;
    text-align: center;
    margin: 0 0 4mm;
    padding-bottom: 2mm;
    border-bottom: 1px solid #000;
  }
  .doc pre {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    font-size: 13pt;
    line-height: 1.6;
    margin: 0;
    overflow: hidden;
  }
  @media print {
    html, body { width: 210mm; height: 297mm; }
    .doc { max-height: 257mm; overflow: hidden; }
    .doc, .doc pre, .meta { page-break-inside: avoid; break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="doc">
    <div class="meta">
      <table>
        <tr>
          <th>شماره پرونده</th>
          <td>${escapeHtml(meta.caseNumber || "—")}</td>
          <th>شعبه</th>
          <td>${escapeHtml(meta.courtBranch || "—")}</td>
        </tr>
        <tr>
          <th>خواهان / شاکی</th>
          <td>${escapeHtml(meta.plaintiff || "—")}</td>
          <th>خوانده / مشتکی‌عنه</th>
          <td>${escapeHtml(meta.defendant || "—")}</td>
        </tr>
      </table>
    </div>
    <h1>${escapeHtml(title)}</h1>
    <pre>${escapeHtml(body)}</pre>
  </div>
</body>
</html>`);
  win.document.close();
  win.focus();
  win.print();
}

export function DraftBuilderDrawer({ isOpen, onClose }: DraftBuilderDrawerProps) {
  const [templateType, setTemplateType] = useState<DraftTemplateType>("DADKHAST");
  const [values, setValues] = useState<Record<string, string>>({});
  const [caseNumber, setCaseNumber] = useState("");
  const [courtBranch, setCourtBranch] = useState("");
  const [sections, setSections] = useState<DraftSection[]>([]);
  const [response, setResponse] = useState<DraftTemplateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(DRAFTS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template_type: templateType,
            data: values,
            court_branch: courtBranch || null,
            case_number: caseNumber || null,
          }),
          signal: controller.signal,
        });
        const data = (await res.json()) as DraftTemplateResponse;
        if (!res.ok || data.status === "error") {
          throw new Error(data.message ?? `HTTP ${res.status}`);
        }
        setResponse(data);
        setSections(data.sections);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "خطا در دریافت الگو");
        // Fallback: render a local form so drafting still works offline.
        setSections(
          FALLBACK_SECTIONS[templateType].map((section) => ({
            key: section.key,
            label: section.label,
            required: section.required,
            hint: "",
            value: values[section.key] ?? null,
            filled: Boolean(values[section.key]),
          })),
        );
        setResponse(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, templateType, values]);

  const selectTemplate = (next: DraftTemplateType) => {
    setTemplateType(next);
    setValues({});
    setResponse(null);
  };

  const applyPreset = (preset: DraftPreset) => {
    setTemplateType(preset.templateType);
    setValues((prev) => ({
      ...prev,
      khastah: preset.subject,
      facts: preset.facts,
      requested_verdict: preset.requestedVerdict,
    }));
  };

  const update = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const fallbackPreview = () => {
    const title = FALLBACK_TITLES[templateType];
    const body = FALLBACK_SECTIONS[templateType]
      .map((section) => `${section.label}: ${values[section.key] ?? "—"}`)
      .join("\n");
    return `${title}\n\n${body}`;
  };

  const factsText = values.facts?.trim() ?? "";
  const verdictText = values.requested_verdict?.trim() ?? "";
  const baseText = response?.rendered_text?.trim() ?? "";
  const previewText =
    [
      baseText,
      factsText ? `شرح واقعه:\n${factsText}` : "",
      verdictText ? `خواسته نهایی:\n${verdictText}` : "",
    ]
      .filter(Boolean)
      .join("\n\n") || fallbackPreview();
  const plaintiff = (values.khahan ?? values.shaki ?? "").trim();
  const defendant = (values.khankhah ?? values.moshtaki_alaih ?? "").trim();

  const copyPreview = async () => {
    try {
      await navigator.clipboard.writeText(previewText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  if (!isOpen) return null;

  const missing = response?.missing_required_fields ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="تنظیم دادخواست و لایحه"
      onClick={onClose}
      className="fixed inset-0 z-[110] flex items-stretch justify-start bg-black/80 backdrop-blur-sm"
      dir="rtl"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-3xl flex-col overflow-hidden border-l border-slate-800 bg-slate-950 text-slate-100 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-amber-300" />
            <h3 className="text-sm font-bold text-white">تنظیم دادخواست و لایحه</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="flex size-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="border-b border-slate-800 px-5 py-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {TEMPLATE_OPTIONS.map((option) => {
              const active = templateType === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => selectTemplate(option.id)}
                  aria-pressed={active}
                  className={`rounded-xl border px-3 py-2 text-right transition-colors ${
                    active
                      ? "border-amber-400/50 bg-amber-400/10"
                      : "border-slate-800 bg-slate-900/50 hover:border-slate-700"
                  }`}
                >
                  <span className={`block text-xs font-bold ${active ? "text-amber-200" : "text-slate-200"}`}>
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-slate-500">{option.hint}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-3">
            <span className="text-[10px] font-semibold text-slate-500">پیش‌فرض‌های آماده</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {DRAFT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="rounded-lg border border-slate-800 bg-slate-900/50 px-2.5 py-1.5 text-[10px] text-slate-300 transition-colors hover:border-amber-400/40 hover:text-white"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-2">
          <div className="overflow-y-auto border-b border-slate-800 p-5 lg:border-b-0 lg:border-l">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs font-bold text-slate-200">فیلدهای لازم</span>
              {loading && <Loader2 className="size-3.5 animate-spin text-amber-300" />}
              {missing.length > 0 && (
                <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
                  {missing.length} فیلد اجباری باقی‌مانده
                </span>
              )}
            </div>

            {error && (
              <p className="mb-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-200">
                {error} — از فرم محلی استفاده می‌شود.
              </p>
            )}

            <div className="space-y-4">
              {sections.map((section) => (
                <div key={section.key}>
                  <label htmlFor={`draft-${section.key}`} className="text-xs font-semibold text-slate-300">
                    {section.label}
                    {section.required && <span className="mr-1 text-rose-400">*</span>}
                  </label>
                  {section.hint && (
                    <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{section.hint}</p>
                  )}
                  <textarea
                    id={`draft-${section.key}`}
                    rows={3}
                    value={values[section.key] ?? ""}
                    onChange={(event) => update(section.key, event.target.value)}
                    className="mt-1.5 w-full resize-none rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-amber-400/50"
                    placeholder={section.label}
                  />
                </div>
              ))}
              {sections.length === 0 && !loading && (
                <p className="text-[11px] text-slate-500">در حال آماده‌سازی فرم…</p>
              )}
            </div>

            <div className="mt-6 space-y-4 border-t border-slate-800 pt-4">
              <span className="text-xs font-bold text-slate-200">شرح واقعه و خواسته</span>
              <div>
                <label htmlFor="draft-facts" className="text-xs font-semibold text-slate-300">
                  شرح واقعه
                </label>
                <textarea
                  id="draft-facts"
                  rows={4}
                  value={values.facts ?? ""}
                  onChange={(event) => update("facts", event.target.value)}
                  className="mt-1.5 w-full resize-none rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-amber-400/50"
                  placeholder="شرح واقعه"
                />
              </div>
              <div>
                <label htmlFor="draft-verdict" className="text-xs font-semibold text-slate-300">
                  خواسته نهایی
                </label>
                <textarea
                  id="draft-verdict"
                  rows={3}
                  value={values.requested_verdict ?? ""}
                  onChange={(event) => update("requested_verdict", event.target.value)}
                  className="mt-1.5 w-full resize-none rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-amber-400/50"
                  placeholder="خواسته نهایی"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="draft-case-number" className="text-xs font-semibold text-slate-300">
                    شماره پرونده
                  </label>
                  <input
                    id="draft-case-number"
                    value={caseNumber}
                    onChange={(event) => setCaseNumber(event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-amber-400/50"
                    placeholder="شماره پرونده"
                  />
                </div>
                <div>
                  <label htmlFor="draft-court-branch" className="text-xs font-semibold text-slate-300">
                    شعبه
                  </label>
                  <input
                    id="draft-court-branch"
                    value={courtBranch}
                    onChange={(event) => setCourtBranch(event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-amber-400/50"
                    placeholder="شعبه"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-200">پیش‌نمایش آماده چاپ</span>
                <span className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  فرمت استاندارد قضایی: ۱ صفحه A4 (خلاصه و موثر)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyPreview()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-[10px] text-slate-300 transition-colors hover:border-slate-700 hover:text-white"
                >
                  {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                  {copied ? "کپی شد" : "کپی متن"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    printDraft(response?.title ?? FALLBACK_TITLES[templateType], previewText, {
                      caseNumber,
                      courtBranch,
                      plaintiff,
                      defendant,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
                >
                  <Printer className="size-3" />
                  چاپ
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {response && (
                <div className="mb-3 space-y-1">
                  {response.statutory_basis.length > 0 && (
                    <p className="text-[10px] text-slate-500">
                      مبنای قانونی: {response.statutory_basis.join(" • ")}
                    </p>
                  )}
                  {response.filing_checklist.length > 0 && (
                    <ul className="list-inside list-disc space-y-0.5 text-[10px] text-slate-500">
                      {response.filing_checklist.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <pre className="whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs leading-relaxed text-slate-200">
                {previewText}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DraftBuilderDrawer;
