"use client";

import { useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  GitBranch,
  Lightbulb,
  ListChecks,
  Quote,
  Sparkles,
  Star,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  EmergingTechnology,
  RadarReportResponse,
  RadarStructuredReport,
} from "@/types/radar";

interface RadarReportProps {
  report: RadarReportResponse | null;
}

const MATURITY_STYLES: Record<string, string> = {
  emerging: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  growing: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  mainstream: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
};

/** دکمه کپی دستور پوسته. */
function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="کپی دستور"
      className="absolute top-2 left-2 rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-300 transition-colors hover:bg-white/10"
    >
      {copied ? <Check className="size-3.5 text-emerald-400" /> : <Clipboard className="size-3.5" />}
    </button>
  );
}

/** رندرکننده گزارش تحلیلی ساختاریافته رادار فناوری. */
export function RadarReport({ report }: RadarReportProps) {
  if (!report?.available) {
    return (
      <Card className="border-0 ring-1 ring-white/10">
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <BookOpen className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            هنوز گزارش رادار فناوری موجود نیست. یک موضوع را کاوش کنید یا ازدحام را اجرا نمایید.
          </p>
        </CardContent>
      </Card>
    );
  }

  const data: RadarStructuredReport = report.structured ?? {};

  return (
    <div className="flex flex-col gap-4">
      {data.executive_summary && (
        <Card className="border-0 bg-gradient-to-br from-sky-500/10 via-transparent to-transparent ring-1 ring-sky-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sky-200">
              <Quote className="size-4" />
              خلاصه مدیریتی
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-7 text-foreground/90">{data.executive_summary}</p>
          </CardContent>
        </Card>
      )}

      {data.key_findings && data.key_findings.length > 0 && (
        <Card className="border-0 ring-1 ring-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-4 text-indigo-400" />
              یافته‌های کلیدی
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {data.key_findings.map((finding, index) => (
                <li
                  key={index}
                  className="flex items-start gap-2 rounded-lg bg-white/[0.02] p-2.5 text-sm leading-relaxed"
                >
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                  <span>{finding}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {data.emerging_technologies && data.emerging_technologies.length > 0 && (
        <Card className="border-0 ring-1 ring-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-fuchsia-400" />
              فناوری‌های نوظهور و روندها
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.emerging_technologies.map(
              (tech: EmergingTechnology, index: number) => {
                const maturityClass =
                  MATURITY_STYLES[(tech.maturity ?? "").toLowerCase()] ??
                  "border-white/15 bg-white/5 text-slate-200";
                return (
                  <div
                    key={index}
                    className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-bold text-foreground">{tech.name}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${maturityClass}`}
                        dir="ltr"
                      >
                        {tech.maturity ?? "n/a"}
                      </span>
                    </div>
                    {tech.category && (
                      <span className="text-[11px] text-muted-foreground">{tech.category}</span>
                    )}
                    {tech.description && (
                      <p className="text-xs leading-relaxed text-foreground/80">
                        {tech.description}
                      </p>
                    )}
                    {tech.why_it_matters && (
                      <p className="text-xs leading-relaxed text-indigo-200/80">
                        اهمیت: {tech.why_it_matters}
                      </p>
                    )}
                    {tech.adoption_signal && (
                      <p className="text-[11px] leading-relaxed text-emerald-200/80">
                        شاهد پذیرش: {tech.adoption_signal}
                      </p>
                    )}
                  </div>
                );
              },
            )}
          </CardContent>
        </Card>
      )}

      {data.top_github_repositories && data.top_github_repositories.length > 0 && (
        <Card className="border-0 ring-1 ring-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="size-4 text-orange-400" />
              ریپازیتوری‌های برتر گیت‌هاب
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>مخزن</TableHead>
                  <TableHead>ستاره</TableHead>
                  <TableHead>زبان</TableHead>
                  <TableHead>چرا مهم است</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.top_github_repositories.map((repo, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium" dir="ltr">
                      {repo.url ? (
                        <a
                          href={repo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200"
                        >
                          {repo.name ?? repo.url}
                          <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        repo.name
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        <Star className="size-3 text-amber-400" />
                        {repo.stars ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{repo.language ?? "—"}</TableCell>
                    <TableCell className="max-w-md whitespace-normal text-xs leading-relaxed text-muted-foreground">
                      {repo.why_relevant ?? repo.description ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data.pros_cons && data.pros_cons.length > 0 && (
        <Card className="border-0 ring-1 ring-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-400" />
              مزایا، معایب و موارد کاربرد
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data.pros_cons.map((item, index) => (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3.5"
              >
                <span className="text-sm font-bold text-foreground">{item.technology}</span>
                {item.pros && item.pros.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {item.pros.map((pro, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-emerald-200/90">
                        <Check className="mt-0.5 size-3 shrink-0" />
                        {pro}
                      </li>
                    ))}
                  </ul>
                )}
                {item.cons && item.cons.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {item.cons.map((con, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-rose-200/90">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                        {con}
                      </li>
                    ))}
                  </ul>
                )}
                {item.best_for && (
                  <p className="text-[11px] text-muted-foreground">مناسب برای: {item.best_for}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.suggested_commands && data.suggested_commands.length > 0 && (
        <Card className="border-0 ring-1 ring-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="size-4 text-sky-400" />
              دستورات اجرایی پیشنهادی
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.suggested_commands.map((item, index) => (
              <div key={index} className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground">{item.purpose}</span>
                <div className="relative rounded-xl border border-white/10 bg-[#020617] p-3 pt-8">
                  <CopyCommand command={item.command ?? ""} />
                  <pre className="overflow-x-auto font-mono text-xs text-emerald-200" dir="ltr">
                    {item.command}
                  </pre>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.risks_and_caveats && data.risks_and_caveats.length > 0 && (
          <Card className="border-0 ring-1 ring-amber-500/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-200">
                <AlertTriangle className="size-4" />
                ریسک‌ها و هشدارها
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {data.risks_and_caveats.map((risk, index) => (
                  <li key={index} className="flex items-start gap-2 text-xs leading-relaxed">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-400" />
                    {risk}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {data.recommendations && data.recommendations.length > 0 && (
          <Card className="border-0 ring-1 ring-indigo-500/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-indigo-200">
                <Lightbulb className="size-4" />
                توصیه‌های راهبردی
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {data.recommendations.map((rec, index) => (
                  <li key={index} className="flex items-start gap-2 text-xs leading-relaxed">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-indigo-400" />
                    {rec}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {data.sources && data.sources.length > 0 && (
        <Card className="border-0 ring-1 ring-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-4 text-muted-foreground" />
              منابع ({data.sources.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {data.sources.map((source, index) => (
              <a
                key={index}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs transition-colors hover:bg-white/[0.05]"
                dir="ltr"
              >
                <span className="text-indigo-200">{source.title || source.url}</span>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {source.crawl_engine ?? "web"} ·{" "}
                  {source.relevance_score !== undefined
                    ? source.relevance_score.toFixed(2)
                    : "—"}
                </Badge>
              </a>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
