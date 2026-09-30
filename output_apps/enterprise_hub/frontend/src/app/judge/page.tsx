"use client";

import { useState } from "react";
import { FileText, Gavel, Scale } from "lucide-react";

import { CaseAnalysisPanel } from "@/components/judge/case-analysis-panel";
import { DraftBuilderDrawer } from "@/components/judge/draft-builder-drawer";
import { JudgeEngineStatus } from "@/components/judge/judge-engine-status";
import { RetrialPanel } from "@/components/judge/retrial-panel";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

type JudgeTab = "analysis" | "retrial";

const TABS: { value: JudgeTab; label: string; icon: typeof Gavel }[] = [
  { value: "analysis", label: "تحلیل پرونده", icon: Gavel },
  { value: "retrial", label: "اعاده دادرسی", icon: Scale },
];

/**
 * میز کار قاضی هوشمند — رابط کاربری لایه AI Core (FastAPI/Python).
 *
 * شامل دو تب اصلی:
 *   • تحلیل پرونده: ورودی شرح پرونده، استخراج مواد قانونی، استدلال قضایی و لایحه
 *   • اعاده دادرسی: ارزیابی شانس پذیرش ماده ۴۷۴ کیفری و ماده ۴۲۶ حقوقی
 * و نمایش وضعیت آنلاین موتور GraphRAG (Qdrant + PostgreSQL + OpenRouter).
 */
export default function JudgePage() {
  const [tab, setTab] = useState<JudgeTab>("analysis");
  const [draftOpen, setDraftOpen] = useState(false);

  return (
    <div className="dark glass-app-bg flex min-h-full flex-1 flex-col text-foreground">
      <GhaziHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">میز کار قاضی هوشمند</h1>
            <p className="text-sm text-muted-foreground">
              استدلال قضایی مبتنی بر Dual-Level GraphRAG و دیسپچر چندسطحی LLM — متصل به{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs" dir="ltr">
                POST /api/v1/apps/judge/analyze-case
              </code>
            </p>
          </div>

          <button
            type="button"
            onClick={() => setDraftOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-amber-500 to-orange-500 px-4 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition-transform hover:-translate-y-0.5"
          >
            <FileText className="size-4" />
            تنظیم دادخواست و لایحه
          </button>
        </div>

        <JudgeEngineStatus />

        <div className="flex gap-2 rounded-xl border bg-background p-1">
          {TABS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                tab === value
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        {tab === "analysis" ? <CaseAnalysisPanel /> : <RetrialPanel />}
      </main>
      <EnamadFooter compact={true} />

      <DraftBuilderDrawer isOpen={draftOpen} onClose={() => setDraftOpen(false)} />
    </div>
  );
}
