import {
  BookOpenCheck,
  CheckCircle2,
  Coins,
  FileWarning,
  Gauge,
  Landmark,
  ListChecks,
  ScrollText,
  Scale,
  TrendingUp,
} from "lucide-react";

import type { ChatResult } from "@/components/chat/types";
import { formatRial } from "@/lib/format";

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
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-white/8 bg-black/30 p-3 text-[12px] leading-relaxed text-slate-200">
              {data.draft_text}
            </pre>
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
