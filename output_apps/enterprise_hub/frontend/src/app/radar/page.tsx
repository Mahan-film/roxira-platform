"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Radar as RadarIcon, Satellite } from "lucide-react";

import { SiteHeader } from "@/components/layout/site-header";
import { RoxiraFooter } from "@/components/layout/roxira-footer";
import { RadarStats } from "@/components/radar/radar-stats";
import { ScoutConsole } from "@/components/radar/scout-console";
import { SwarmGrid } from "@/components/radar/swarm-grid";
import { RadarReport } from "@/components/radar/radar-report";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getRadarReport,
  getScoutStatus,
  getSwarmStatus,
  runSwarm,
  triggerScout,
} from "@/lib/api/radar-client";
import { ApiClientError } from "@/lib/api/http-client";
import type {
  RadarReportResponse,
  RadarScoutStatus,
  RadarSwarmStatus,
} from "@/types/radar";

/**
 * پنل متمرکز فرماندهی رادار فناوری (Mission Control).
 *
 * کارت‌های بنتو شاخص‌ها، کنسول کاوشگر زنده با موضوع دلخواه، شبکه وضعیت
 * لحظه‌ای ۱۰ ایجنت موازی و رندرکننده گزارش تحلیلی — همه متصل به ماژول
 * `enterprise-hub/radar` در لایه NestJS.
 */
export default function RadarPage() {
  const [report, setReport] = useState<RadarReportResponse | null>(null);
  const [scout, setScout] = useState<RadarScoutStatus | null>(null);
  const [swarm, setSwarm] = useState<RadarSwarmStatus | null>(null);
  const [topic, setTopic] = useState("");
  const [deep, setDeep] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isReportLoading, setIsReportLoading] = useState(true);
  const [isScoutSubmitting, setIsScoutSubmitting] = useState(false);
  const [isSwarmSubmitting, setIsSwarmSubmitting] = useState(false);

  const describeError = useCallback((error: unknown): string => {
    if (error instanceof ApiClientError) {
      return error.details.join(" | ");
    }
    if (error instanceof DOMException) {
      return "";
    }
    return "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.";
  }, []);

  const loadReport = useCallback(
    async (signal?: AbortSignal) => {
      setIsReportLoading(true);
      try {
        setReport(await getRadarReport(signal));
      } catch (error) {
        const message = describeError(error);
        if (message) setErrorMessage(message);
      } finally {
        setIsReportLoading(false);
      }
    },
    [describeError],
  );

  const loadStatuses = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [scoutStatus, swarmStatus] = await Promise.all([
          getScoutStatus(signal),
          getSwarmStatus(signal),
        ]);
        setScout(scoutStatus);
        setSwarm(swarmStatus);
      } catch (error) {
        const message = describeError(error);
        if (message) setErrorMessage(message);
      }
    },
    [describeError],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadReport(controller.signal);
    loadStatuses(controller.signal);
    return () => controller.abort();
  }, [loadReport, loadStatuses]);

  // نظرسنجی لحظه‌ای کاوشگر تا پایان اجرا و سپس تازه‌سازی گزارش.
  useEffect(() => {
    if (scout?.status !== "RUNNING") {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const status = await getScoutStatus();
        setScout(status);
        if (status.status !== "RUNNING") {
          void loadReport();
        }
      } catch {
        // خطای گذرا در نظرسنجی نادیده گرفته می‌شود.
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [scout?.status, loadReport]);

  // نظرسنجی لحظه‌ای استخر ۱۰ ایجنت.
  useEffect(() => {
    if (swarm?.status !== "RUNNING") {
      return;
    }
    const timer = setInterval(async () => {
      try {
        setSwarm(await getSwarmStatus());
      } catch {
        // خطای گذرا در نظرسنجی نادیده گرفته می‌شود.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [swarm?.status]);

  async function handleTriggerScout() {
    if (topic.trim().length < 3) {
      setErrorMessage("موضوع پژوهش باید حداقل ۳ نویسه باشد.");
      return;
    }
    setErrorMessage(null);
    setIsScoutSubmitting(true);
    try {
      setScout(await triggerScout({ topic: topic.trim(), deep }));
    } catch (error) {
      const message = describeError(error);
      if (message) setErrorMessage(message);
    } finally {
      setIsScoutSubmitting(false);
    }
  }

  async function handleRunSwarm() {
    setErrorMessage(null);
    setIsSwarmSubmitting(true);
    try {
      setSwarm(await runSwarm({ timeoutSeconds: 180 }));
    } catch (error) {
      const message = describeError(error);
      if (message) setErrorMessage(message);
    } finally {
      setIsSwarmSubmitting(false);
    }
  }

  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <RadarIcon className="size-6 text-indigo-500" />
              مرکز فرماندهی رادار فناوری
            </h1>
            <p className="text-sm text-muted-foreground">
              کاوش زنده وب، سنتز راهبردی و ارکستراسیون ۱۰ ایجنت موازی — متصل به{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                /enterprise-hub/radar
              </code>
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void loadReport();
              void loadStatuses();
            }}
            disabled={isReportLoading}
          >
            <RefreshCw className={`size-4 ${isReportLoading ? "animate-spin" : ""}`} />
            تازه‌سازی
          </Button>
        </div>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>خطا در مرکز فرماندهی رادار</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <RadarStats report={report} swarm={swarm} isLoading={isReportLoading} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ScoutConsole
            topic={topic}
            onTopicChange={setTopic}
            deep={deep}
            onDeepChange={setDeep}
            onTrigger={handleTriggerScout}
            status={scout}
            isSubmitting={isScoutSubmitting}
          />
          <SwarmGrid
            swarm={swarm}
            onRun={handleRunSwarm}
            isSubmitting={isSwarmSubmitting}
          />
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Satellite className="size-4 text-indigo-400" />
          <h2 className="text-lg font-bold tracking-tight">گزارش تحلیلی رادار</h2>
        </div>

        <RadarReport report={report} />
      </main>
      <RoxiraFooter />
    </div>
  );
}
