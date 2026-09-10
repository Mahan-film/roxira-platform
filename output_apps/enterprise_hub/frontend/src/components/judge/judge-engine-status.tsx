"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Activity, Database, Network, RefreshCw, Server, Sparkles } from "lucide-react";

import { getJudgeEngineHealth, JudgeEngineHealth } from "@/lib/api/smart-judge-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ConnectionState = "loading" | "online" | "offline";

/**
 * نمایش وضعیت آنلاین موتور GraphRAG قاضی هوشمند.
 * به‌صورت دوره‌ای (هر ۳۰ ثانیه) اندپوینت `/health` را استعلام می‌کند و
 * وضعیت لایه‌های بازیابی (Qdrant Vector + PostgreSQL Graph + OpenRouter LLM)
 * را نمایش می‌دهد.
 */
export function JudgeEngineStatus() {
  const [health, setHealth] = useState<JudgeEngineHealth | null>(null);
  const [state, setState] = useState<ConnectionState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const probe = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await getJudgeEngineHealth(signal);
      setHealth(data);
      setState("online");
      setError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setState("offline");
      setError(err instanceof Error ? err.message : "ارتباط با موتور برقرار نشد.");
    }
  }, []);

  const refresh = useCallback(
    (signal?: AbortSignal) => {
      startTransition(async () => {
        await probe(signal);
      });
    },
    [probe],
  );

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    const interval = setInterval(() => refresh(), 30_000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [refresh]);

  const isOnline = state === "online";
  const graphNodes = health?.graph_db?.graph_nodes;
  const graphEdges = health?.graph_db?.graph_edges;

  return (
    <Card className="border-primary/20 bg-gradient-to-l from-primary/5 to-transparent">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              {isOnline && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex size-2.5 rounded-full ${
                  isOnline ? "bg-emerald-500" : state === "loading" ? "bg-amber-500" : "bg-red-500"
                }`}
              />
            </span>
            <span className="text-sm font-semibold">
              موتور GraphRAG قاضی هوشمند:{" "}
              {isOnline ? "آنلاین" : state === "loading" ? "در حال بررسی..." : "آفلاین"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {health && (
              <>
                <Badge variant={health.llm_configured ? "secondary" : "destructive"}>
                  <Sparkles className="size-3" />
                  LLM {health.llm_configured ? "فعال" : "تنظیم‌نشده"}
                </Badge>
                <Badge variant="outline">{health.stt}</Badge>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => refresh()}
              aria-label="به‌روزرسانی وضعیت موتور"
            >
              <RefreshCw className={`size-3.5 ${isPending ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {error && !isOnline && (
          <p className="text-xs text-destructive">
            {error} — مسیر `/api/v1/apps/judge/health` در دسترس نیست.
          </p>
        )}

        {health && isOnline && (
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
              <Database className="size-4 text-primary" />
              <div>
                <div className="text-muted-foreground">کالکشن‌های برداری</div>
                <div className="font-semibold">{health.collections.length} مجموعه Qdrant</div>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
              <Network className="size-4 text-primary" />
              <div>
                <div className="text-muted-foreground">گراف حقوقی</div>
                <div className="font-semibold">
                  {graphNodes ?? "—"} گره / {graphEdges ?? "—"} رابطه
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
              <Activity className="size-4 text-primary" />
              <div>
                <div className="text-muted-foreground">روابط گراف</div>
                <div className="font-semibold">{health.graph_relations.join(" / ")}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
              <Server className="size-4 text-primary" />
              <div>
                <div className="text-muted-foreground">پایگاه گراف</div>
                <div className="font-semibold">{health.graph_db?.host ?? "PostgreSQL"}</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
