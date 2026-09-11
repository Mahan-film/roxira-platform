"use client";

import { Loader2, RadioTower, Rocket, Terminal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { RadarScoutStatus } from "@/types/radar";

interface ScoutConsoleProps {
  topic: string;
  onTopicChange: (value: string) => void;
  deep: boolean;
  onDeepChange: (value: boolean) => void;
  onTrigger: () => void;
  status: RadarScoutStatus | null;
  isSubmitting: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  IDLE: "آماده",
  RUNNING: "در حال کاوش",
  COMPLETED: "تکمیل شد",
  FAILED: "ناموفق",
};

/** کنسول کاوشگر زنده: ورودی موضوع و نمایش پیشرفت لحظه‌ای. */
export function ScoutConsole({
  topic,
  onTopicChange,
  deep,
  onDeepChange,
  onTrigger,
  status,
  isSubmitting,
}: ScoutConsoleProps) {
  const isRunning = status?.status === "RUNNING";
  const logTail = status?.log?.slice(-8) ?? [];

  return (
    <Card className="border-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent ring-1 ring-indigo-500/20">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-indigo-200">
            <RadioTower className="size-4" />
            کاوشگر زنده فناوری
          </span>
          <Badge
            variant={status?.status === "FAILED" ? "destructive" : "secondary"}
            className="font-mono"
            dir="ltr"
          >
            {status?.status ?? "IDLE"} · {STATUS_LABELS[status?.status ?? "IDLE"] ?? "—"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={topic}
            onChange={(event) => onTopicChange(event.target.value)}
            placeholder="موضوع پژوهش، مثلاً: 2026 open-source AI agent frameworks"
            dir="auto"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isRunning && topic.trim().length >= 3) {
                onTrigger();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={deep}
              onClick={() => onDeepChange(!deep)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                deep
                  ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-200"
                  : "border-white/10 text-muted-foreground hover:bg-white/5"
              }`}
            >
              حالت عمیق
            </button>
            <Button
              onClick={onTrigger}
              disabled={isRunning || topic.trim().length < 3}
              className="min-w-32"
            >
              {isSubmitting || isRunning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Rocket className="size-4" />
              )}
              {isRunning ? "در حال کاوش..." : "اجرای کاوشگر"}
            </Button>
          </div>
        </div>

        {(isRunning || logTail.length > 0) && (
          <div className="rounded-xl border border-white/10 bg-[#020617] p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-slate-400">
              <Terminal className="size-3.5" />
              لاگ زنده
            </div>
            <pre
              className="max-h-40 overflow-auto font-mono text-[10px] leading-relaxed text-slate-300"
              dir="ltr"
            >
              {logTail.length > 0
                ? logTail.join("\n")
                : "در حال آماده‌سازی موتور کاوش..."}
            </pre>
          </div>
        )}

        {status?.error && (
          <p className="text-xs text-rose-300">⚠️ {status.error}</p>
        )}
      </CardContent>
    </Card>
  );
}
