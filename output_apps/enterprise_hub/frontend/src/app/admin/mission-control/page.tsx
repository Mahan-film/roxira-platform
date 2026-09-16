"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Cpu,
  Database,
  Loader2,
  RefreshCw,
  Send,
  Server,
  Terminal,
  XCircle,
} from "lucide-react";

type LoadState = "checking" | "online" | "degraded" | "offline";

interface ProbeTarget {
  id: string;
  name: string;
  port: string;
  description: string;
  url: string;
  mode: RequestMode;
  icon: typeof Activity;
  accent: string;
}

interface ProbeResult {
  state: LoadState;
  latencyMs: number | null;
  httpStatus: number | null;
  message: string;
}

const FACTORY_ENDPOINT =
  process.env.NEXT_PUBLIC_FACTORY_SYNTHESIZE_URL ?? "/api/v1/factory/synthesize-app";

const TARGETS: ProbeTarget[] = [
  {
    id: "ghazi",
    name: "Ghazihoushmand AI",
    port: ":8000",
    description: "FastAPI · Dual-Level GraphRAG",
    url: process.env.NEXT_PUBLIC_JUDGE_HEALTH_URL ?? "/api/v1/apps/judge/health",
    mode: "cors",
    icon: Cpu,
    accent: "text-amber-300",
  },
  {
    id: "qdrant",
    name: "Qdrant Vector DB",
    port: ":6333",
    description: "Vector Store · BGE-M3",
    url: process.env.NEXT_PUBLIC_QDRANT_HEALTH_URL ?? "http://localhost:6333/healthz",
    mode: "no-cors",
    icon: Database,
    accent: "text-cyan-300",
  },
  {
    id: "hub",
    name: "Enterprise Hub",
    port: ":3000",
    description: "NestJS · Modular API",
    url: process.env.NEXT_PUBLIC_HUB_HEALTH_URL ?? "http://localhost:3000/health/system",
    mode: "no-cors",
    icon: Server,
    accent: "text-emerald-300",
  },
];

const STATE_STYLES: Record<LoadState, { dot: string; text: string; label: string }> = {
  checking: { dot: "bg-slate-500 animate-pulse", text: "text-slate-400", label: "CHECKING" },
  online: { dot: "bg-emerald-400", text: "text-emerald-300", label: "ONLINE" },
  degraded: { dot: "bg-amber-400", text: "text-amber-300", label: "DEGRADED" },
  offline: { dot: "bg-rose-500", text: "text-rose-300", label: "OFFLINE" },
};

const INITIAL_RESULTS: Record<string, ProbeResult> = TARGETS.reduce<Record<string, ProbeResult>>(
  (acc, target) => {
    acc[target.id] = { state: "checking", latencyMs: null, httpStatus: null, message: "Probing" };
    return acc;
  },
  {},
);

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function probe(target: ProbeTarget, parentSignal: AbortSignal): Promise<ProbeResult | null> {
  const started = performance.now();
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  parentSignal.addEventListener("abort", abortFromParent);
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(target.url, {
      signal: controller.signal,
      cache: "no-store",
      mode: target.mode,
    });
    const latencyMs = Math.round(performance.now() - started);
    if (res.type === "opaque" || res.ok) {
      return {
        state: "online",
        latencyMs,
        httpStatus: res.type === "opaque" ? null : res.status,
        message: res.type === "opaque" ? "Reachable" : "Operational",
      };
    }
    return { state: "degraded", latencyMs, httpStatus: res.status, message: `HTTP ${res.status}` };
  } catch (error) {
    if (parentSignal.aborted) return null;
    const latencyMs = Math.round(performance.now() - started);
    if (controller.signal.aborted) {
      return { state: "offline", latencyMs: null, httpStatus: null, message: "Timeout" };
    }
    return {
      state: "offline",
      latencyMs,
      httpStatus: null,
      message: error instanceof Error ? error.message : "Network error",
    };
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

export default function MissionControlPage() {
  const [results, setResults] = useState<Record<string, ProbeResult>>(INITIAL_RESULTS);
  const [refreshing, setRefreshing] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [prompt, setPrompt] = useState("");
  const [framework, setFramework] = useState("FastAPI");
  const [submitting, setSubmitting] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [consoleError, setConsoleError] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);

  const checkAll = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRefreshing(true);
    setResults((prev) => {
      const next = { ...prev };
      for (const target of TARGETS) {
        next[target.id] = { state: "checking", latencyMs: null, httpStatus: null, message: "Probing" };
      }
      return next;
    });

    await Promise.all(
      TARGETS.map(async (target) => {
        const result = await probe(target, controller.signal);
        if (result && !controller.signal.aborted) {
          setResults((prev) => ({ ...prev, [target.id]: result }));
        }
      }),
    );

    if (!controller.signal.aborted) {
      setLastCheckedAt(Date.now());
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      void checkAll();
    }, 0);
    const interval = setInterval(() => {
      void checkAll();
    }, 20_000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [checkAll]);

  const synthesize = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setConsoleError(null);
    setOutput(null);
    try {
      const res = await fetch(FACTORY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed, target_framework: framework }),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
      if (!res.ok) {
        setConsoleError(`HTTP ${res.status} — ${formatUnknown(parsed)}`);
        return;
      }
      setOutput(formatUnknown(parsed));
      setLastRunAt(Date.now());
    } catch (error) {
      setConsoleError(error instanceof Error ? error.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }, [prompt, framework, submitting]);

  return (
    <div dir="ltr" className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(251,191,36,0.08),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.04)_1px,transparent_1px)] bg-[size:44px_44px]" />

      <div className="relative mx-auto max-w-6xl px-5 py-10 sm:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-800/80 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-300">
              <Activity className="size-5" />
            </span>
            <div>
              <h1 className="font-mono text-lg font-bold tracking-[0.2em] text-slate-100">
                ROXIRA MISSION CONTROL
              </h1>
              <p className="text-xs text-slate-500">
                Live infrastructure telemetry &amp; autonomous software foundry
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-slate-500">
              {lastCheckedAt ? `synced ${new Date(lastCheckedAt).toLocaleTimeString()}` : "syncing…"}
            </span>
            <button
              type="button"
              onClick={() => void checkAll()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 font-mono text-[11px] text-slate-300 transition-colors hover:border-slate-700 hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
              REFRESH
            </button>
          </div>
        </header>

        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {TARGETS.map((target) => {
            const Icon = target.icon;
            const result = results[target.id] ?? INITIAL_RESULTS[target.id];
            const tone = STATE_STYLES[result.state];
            return (
              <article
                key={target.id}
                className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 backdrop-blur transition-colors hover:border-slate-700"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <Icon className={`size-4 ${target.accent}`} />
                    <div>
                      <h2 className="text-sm font-semibold text-slate-100">{target.name}</h2>
                      <p className="font-mono text-[10px] text-slate-500">{target.port}</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1.5 font-mono text-[10px]">
                    <span className={`size-2 rounded-full ${tone.dot}`} />
                    <span className={tone.text}>{tone.label}</span>
                  </span>
                </div>

                <p className="mt-4 text-[11px] text-slate-500">{target.description}</p>

                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-800/70 pt-3 font-mono text-[11px]">
                  <div>
                    <div className="text-slate-600">LATENCY</div>
                    <div className="text-slate-200">
                      {result.latencyMs === null ? "—" : `${result.latencyMs} ms`}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-600">HTTP</div>
                    <div className="text-slate-200">
                      {result.httpStatus === null ? "—" : result.httpStatus}
                    </div>
                  </div>
                </div>

                <p className="mt-3 truncate font-mono text-[10px] text-slate-600" title={result.message}>
                  {result.message}
                </p>
              </article>
            );
          })}
        </section>

        <section className="mt-8 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/70 pb-4">
            <div className="flex items-center gap-2.5">
              <Terminal className="size-4 text-amber-300" />
              <h2 className="font-mono text-sm font-bold tracking-wider text-slate-100">
                ROXIRA SOFTWARE FOUNDRY
              </h2>
            </div>
            <span className="font-mono text-[10px] text-slate-500">
              POST {FACTORY_ENDPOINT}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <label htmlFor="foundry-prompt" className="font-mono text-[10px] text-slate-500">
                SPEC PROMPT
              </label>
              <textarea
                id="foundry-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void synthesize();
                  }
                }}
                rows={7}
                placeholder="Describe the module to synthesize… (⌘/Ctrl + Enter to run)"
                className="mt-2 w-full resize-none rounded-xl border border-slate-800 bg-slate-950/80 p-4 font-mono text-xs leading-relaxed text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-amber-400/50"
              />
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="foundry-framework" className="font-mono text-[10px] text-slate-500">
                  TARGET FRAMEWORK
                </label>
                <select
                  id="foundry-framework"
                  value={framework}
                  onChange={(event) => setFramework(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2.5 font-mono text-xs text-slate-200 outline-none focus:border-amber-400/50"
                >
                  <option value="FastAPI">FastAPI</option>
                  <option value="NestJS">NestJS</option>
                  <option value="NextJS">Next.js</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => void synthesize()}
                disabled={submitting || !prompt.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-3 font-mono text-xs font-bold text-slate-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    SYNTHESIZING…
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    SYNTHESIZE APP
                  </>
                )}
              </button>

              {lastRunAt && (
                <p className="font-mono text-[10px] text-slate-600">
                  last run {new Date(lastRunAt).toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>

          {(output || consoleError || submitting) && (
            <div className="mt-5 rounded-xl border border-slate-800/80 bg-slate-950/80 p-4">
              <div className="mb-2 flex items-center gap-2 font-mono text-[10px]">
                {consoleError ? (
                  <>
                    <XCircle className="size-3.5 text-rose-400" />
                    <span className="text-rose-400">SYNTHESIS FAILED</span>
                  </>
                ) : submitting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin text-amber-300" />
                    <span className="text-amber-300">AWAITING RESPONSE</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                    <span className="text-emerald-400">SYNTHESIS COMPLETE</span>
                  </>
                )}
              </div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">
                {consoleError ?? output ?? "…"}
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
