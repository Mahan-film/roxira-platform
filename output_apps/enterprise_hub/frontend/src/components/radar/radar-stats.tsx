"use client";

import {
  Activity,
  CalendarClock,
  Cpu,
  FileSearch,
  Gauge,
  Layers,
  Radar,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RadarReportResponse, RadarSwarmStatus } from "@/types/radar";

interface RadarStatsProps {
  report: RadarReportResponse | null;
  swarm: RadarSwarmStatus | null;
  isLoading: boolean;
}

/** قالب‌بندی اعداد فارسی. */
function fa(value: number | undefined, fallback = "—"): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return fallback;
  }
  return new Intl.NumberFormat("fa-IR").format(value);
}

/** کارت بنتو شاخص‌های کلیدی مأموریت رادار فناوری. */
export function RadarStats({ report, swarm, isLoading }: RadarStatsProps) {
  const confidence =
    report?.confidence !== undefined
      ? `${Math.round(report.confidence * 100)}٪`
      : "—";
  const generatedAt = report?.generatedAt
    ? new Date(report.generatedAt).toLocaleString("fa-IR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

  const healthyAgents = swarm ? swarm.summary.success : 0;
  const failedAgents = swarm ? swarm.summary.failed : 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="sm:col-span-2 border-0 bg-gradient-to-br from-indigo-500/15 via-transparent to-transparent ring-1 ring-indigo-500/25">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-indigo-300">
            <Radar className="size-4" />
            موضوع آخرین پایش
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-base font-semibold leading-relaxed text-foreground" dir="auto">
            {report?.topic ?? "هنوز گزارشی تولید نشده است."}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono" dir="ltr">
              {report?.status ?? "NO_DATA"}
            </span>
            <span>حالت: {report?.mode ?? "—"}</span>
            <span>مدل سنتز: {report?.model ?? "—"}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 ring-1 ring-emerald-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Gauge className="size-4 text-emerald-400" />
            اطمینان گزارش
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-end justify-between">
          <span className="text-3xl font-black text-emerald-300">{confidence}</span>
          <FileSearch className="size-5 text-emerald-400/60" />
        </CardContent>
      </Card>

      <Card className="border-0 ring-1 ring-sky-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Layers className="size-4 text-sky-400" />
            منابع تحلیل‌شده
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-end justify-between">
          <span className="text-3xl font-black text-sky-300">
            {fa(report?.sourceCount, isLoading ? "…" : "—")}
          </span>
          <CalendarClock className="size-5 text-sky-400/60" />
        </CardContent>
      </Card>

      <Card className="sm:col-span-2 border-0 bg-gradient-to-br from-fuchsia-500/10 via-transparent to-transparent ring-1 ring-fuchsia-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Activity className="size-4 text-fuchsia-400" />
            وضعیت استخر ۱۰ ایجنت
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-2xl font-black text-emerald-300">{fa(healthyAgents)}</span>
              <span className="text-[11px] text-muted-foreground">موفق</span>
            </div>
            <div className="flex flex-col">
              <span className="text-2xl font-black text-rose-300">{fa(failedAgents)}</span>
              <span className="text-[11px] text-muted-foreground">ناموفق</span>
            </div>
            <div className="flex flex-col">
              <span className="text-2xl font-black text-amber-300">
                {fa(swarm?.summary.running ?? 0)}
              </span>
              <span className="text-[11px] text-muted-foreground">در حال اجرا</span>
            </div>
          </div>
          <Cpu className="size-8 text-fuchsia-400/50" />
        </CardContent>
      </Card>

      <Card className="sm:col-span-2 lg:col-span-4 border-0 ring-1 ring-white/10">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <CalendarClock className="size-3.5" />
            زمان تولید گزارش: {generatedAt}
          </span>
          <span className="flex items-center gap-2">
            <FileSearch className="size-3.5" />
            وضعیت فایل: {report?.available ? "در دسترس" : "ناموجود"}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
