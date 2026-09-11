"use client";

import { CircleDot, Loader2, Network, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RadarAgentState, RadarSwarmStatus } from "@/types/radar";

interface SwarmGridProps {
  swarm: RadarSwarmStatus | null;
  onRun: () => void;
  isSubmitting: boolean;
}

/** رنگ و برچسب هر وضعیت ایجنت. */
const STATE_STYLES: Record<
  RadarAgentState,
  { dot: string; label: string; badge: "default" | "secondary" | "destructive" | "outline" }
> = {
  PENDING: { dot: "bg-slate-500", label: "در انتظار", badge: "outline" },
  RUNNING: { dot: "bg-amber-400 animate-pulse", label: "در حال اجرا", badge: "secondary" },
  SUCCESS: { dot: "bg-emerald-400", label: "موفق", badge: "default" },
  FAILED: { dot: "bg-rose-500", label: "ناموفق", badge: "destructive" },
};

/** شبکه وضعیت لحظه‌ای ۱۰ ایجنت موازی. */
export function SwarmGrid({ swarm, onRun, isSubmitting }: SwarmGridProps) {
  const isRunning = swarm?.status === "RUNNING";
  const agents = swarm?.agents ?? [];

  return (
    <Card className="border-0 ring-1 ring-white/10">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Network className="size-4 text-fuchsia-400" />
            ازدحام ۱۰ ایجنت موازی
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono" dir="ltr">
              {swarm?.status ?? "IDLE"}
            </Badge>
            <Button onClick={onRun} disabled={isSubmitting || isRunning} size="sm">
              {isSubmitting || isRunning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {isRunning ? "در حال اجرا..." : "اجرای ازدحام"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {agents.map((agent) => {
            const style = STATE_STYLES[agent.status] ?? STATE_STYLES.PENDING;
            return (
              <div
                key={agent.id}
                className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className={`size-2.5 rounded-full ${style.dot}`} />
                    <Badge variant={style.badge} className="text-[10px]">
                      {style.label}
                    </Badge>
                  </span>
                  <CircleDot className="size-3.5 text-muted-foreground/50" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground">
                    {agent.label}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                    {agent.id}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {agent.task}
                </p>
                <div className="mt-auto flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>زمان: {agent.elapsedSeconds ?? "—"}s</span>
                  {agent.status === "FAILED" && agent.stderr ? (
                    <span className="max-w-24 truncate text-rose-300" title={agent.stderr}>
                      {agent.stderr}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}

          {agents.length === 0 && (
            <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
              هنوز اجرایی ثبت نشده است؛ دکمه «اجرای ازدحام» را بزنید.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
