"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Boxes,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  Server,
  Terminal,
  Trash2,
  Users,
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

const FACTORY_BASE = process.env.NEXT_PUBLIC_FACTORY_API_BASE ?? "/api/v1/factory";
const FACTORY_SYNTHESIZE_ENDPOINT =
  process.env.NEXT_PUBLIC_FACTORY_SYNTHESIZE_URL ?? `${FACTORY_BASE}/synthesize-app`;

interface FactoryBuildStage {
  stage: string;
  at: number;
}

interface FactoryBuildStatus {
  app_id: string;
  stage: string;
  status: string;
  app_name?: string | null;
  prompt?: string | null;
  target_framework?: string | null;
  tier?: string | null;
  host_port?: number | null;
  subdomain?: string | null;
  url?: string | null;
  container_id?: string | null;
  container_name?: string | null;
  error?: string | null;
  stages?: FactoryBuildStage[];
  swarm?: SwarmMetadata | null;
  updated_at?: number;
}

const PIPELINE_STAGES: { key: string; label: string }[] = [
  { key: "QUEUED", label: "در صف ساخت" },
  { key: "PORT_ALLOCATED", label: "تخصیص پورت" },
  { key: "PROJECT_GENERATED", label: "تولید پروژه" },
  { key: "BUILDING", label: "بیلد ایمیج" },
  { key: "CONTAINER_STARTED", label: "اجرای کانتینر" },
  { key: "ROUTE_REGISTERED", label: "ثبت مسیر Nginx" },
  { key: "RUNNING", label: "در حال اجرا" },
];

const TERMINAL_STAGES = new Set(["RUNNING", "FAILED", "REJECTED"]);

type BuildTier = "FRONTIER" | "AUTONOMOUS_SWARM";

const BUILD_TIERS: { id: BuildTier; name: string; hint: string }[] = [
  { id: "FRONTIER", name: "Frontier Sandbox", hint: "Single container · fast path" },
  { id: "AUTONOMOUS_SWARM", name: "Autonomous Agent Swarm", hint: "30-Min Zero-Touch team pipeline" },
];

type SwarmTeamState = "pending" | "active" | "done" | "failed";

interface SwarmTeam {
  stage: string;
  icon: string;
  name: string;
  role: string;
}

const SWARM_TEAMS: SwarmTeam[] = [
  { stage: "ARCHITECT_RESEARCH", icon: "🏛️", name: "Chief Architect", role: "OpenAPI & Blueprint" },
  { stage: "SCHEMA_DESIGN", icon: "🗄️", name: "Database Squad", role: "PostgreSQL & TableSpec" },
  { stage: "BACKEND_GENERATION", icon: "⚡", name: "Backend Squad", role: "FastAPI Contract Endpoints" },
  { stage: "FRONTEND_GENERATION", icon: "🎨", name: "Frontend Squad", role: "Next.js 16 Accounting Views" },
  { stage: "QA_EVALUATION", icon: "🧪", name: "QA Evaluator", role: "Contract Conformance & Type Safety" },
];

const SWARM_STAGE_ORDER = SWARM_TEAMS.map((team) => team.stage);

const SWARM_STATE_STYLES: Record<SwarmTeamState, { dot: string; text: string; label: string }> = {
  pending: { dot: "bg-slate-600", text: "text-slate-500", label: "PENDING" },
  active: { dot: "bg-amber-400", text: "text-amber-300", label: "ACTIVE" },
  done: { dot: "bg-emerald-400", text: "text-emerald-300", label: "DONE" },
  failed: { dot: "bg-rose-500", text: "text-rose-300", label: "FAILED" },
};

function isSwarmTier(tier?: string | null): boolean {
  const key = (tier ?? "").trim().toUpperCase();
  return key === "AUTONOMOUS_SWARM" || key === "SWARM" || key === "AUTONOMOUS";
}

function swarmTeamState(team: SwarmTeam, swarmStatus?: string | null): SwarmTeamState {
  const status = (swarmStatus ?? "").trim().toUpperCase();
  if (status === "FAILED") return "failed";
  if (status === "DONE" || status === "SUCCESS" || status === "COMPLETED") return "done";
  const current = SWARM_STAGE_ORDER.indexOf(status);
  const target = SWARM_STAGE_ORDER.indexOf(team.stage);
  if (current < 0) return "pending";
  if (current > target) return "done";
  if (current === target) return "active";
  return "pending";
}

function qaPercent(score?: number | null): number | null {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  return Math.round(score <= 1 ? score * 100 : score);
}

interface SwarmMetadata {
  status?: string | null;
  stage?: string | null;
  qa?: { score?: number | null } | null;
}

interface SandboxHistoryEntry {
  app_id: string;
  stage: string;
  status: string;
  host_port: number | null;
  subdomain: string | null;
  url: string | null;
  updated_at: number;
  health?: string | null;
  container_id?: string | null;
  tier?: string | null;
  swarm_status?: string | null;
  swarm_qa_score?: number | null;
}

const HISTORY_KEY = "roxira.foundry.sandboxes";
const HISTORY_LIMIT = 12;

interface SandboxSummary {
  app_id: string;
  app_name?: string | null;
  status?: string;
  stage?: string;
  port?: number | null;
  host_port?: number | null;
  subdomain?: string | null;
  url?: string | null;
  container_id?: string | null;
  deployed?: boolean;
  health?: string | null;
  tier?: string | null;
  swarm_status?: string | null;
  swarm_qa_score?: number | null;
  swarm?: SwarmMetadata | null;
  created_at?: number;
  updated_at?: number;
}

const SANDBOX_BADGE: Record<string, string> = {
  RUNNING: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  QUEUED: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  FAILED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
  REJECTED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
  DESTROYED: "border-slate-600/50 bg-slate-700/20 text-slate-400",
};
const SANDBOX_BADGE_DEFAULT = "border-amber-400/30 bg-amber-400/10 text-amber-300";

const HEALTH_STYLES: Record<string, { dot: string; text: string; label: string }> = {
  HEALTHY: { dot: "bg-emerald-400", text: "text-emerald-300", label: "HEALTHY" },
  STARTING: { dot: "bg-amber-400", text: "text-amber-300", label: "STARTING" },
  UNHEALTHY: { dot: "bg-rose-500", text: "text-rose-300", label: "UNHEALTHY" },
};

function classifyFromStage(stage: string): string {
  if (stage === "RUNNING") return "HEALTHY";
  if (stage === "FAILED" || stage === "REJECTED" || stage === "DESTROYED") return "UNHEALTHY";
  return "STARTING";
}

type SandboxFilter = "all" | "running" | "failed" | "destroyed";

const SANDBOX_FILTERS: { id: SandboxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "failed", label: "Failed" },
  { id: "destroyed", label: "Destroyed" },
];

function matchesFilter(entry: SandboxHistoryEntry, filter: SandboxFilter): boolean {
  switch (filter) {
    case "running":
      return entry.stage === "RUNNING";
    case "failed":
      return entry.stage === "FAILED" || entry.stage === "REJECTED";
    case "destroyed":
      return entry.stage === "DESTROYED";
    default:
      return true;
  }
}

function loadHistory(): SandboxHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SandboxHistoryEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { app_id?: unknown }).app_id === "string",
    );
  } catch {
    return [];
  }
}

function toHistoryEntry(source: SandboxSummary): SandboxHistoryEntry {
  const port =
    typeof source.host_port === "number"
      ? source.host_port
      : typeof source.port === "number"
        ? source.port
        : null;
  const stage = source.stage ?? source.status ?? "UNKNOWN";
  return {
    app_id: source.app_id,
    stage,
    status: source.status ?? stage,
    host_port: port,
    subdomain: source.subdomain ?? null,
    url: source.url ?? null,
    updated_at: source.updated_at ?? source.created_at ?? Date.now() / 1000,
    health: source.health ?? classifyFromStage(stage),
    container_id: source.container_id ?? null,
    tier: source.tier ?? null,
    swarm_status: source.swarm_status ?? source.swarm?.status ?? source.swarm?.stage ?? null,
    swarm_qa_score: source.swarm_qa_score ?? source.swarm?.qa?.score ?? null,
  };
}

function upsertHistory(prev: SandboxHistoryEntry[], source: SandboxSummary): SandboxHistoryEntry[] {
  const next = toHistoryEntry(source);
  const index = prev.findIndex((entry) => entry.app_id === next.app_id);
  if (index === -1) return [next, ...prev].slice(0, HISTORY_LIMIT);

  const existing = prev[index];
  if (
    existing.stage === next.stage &&
    existing.status === next.status &&
    existing.host_port === next.host_port &&
    existing.subdomain === next.subdomain &&
    existing.url === next.url
  ) {
    return prev;
  }
  const copy = [...prev];
  copy[index] = next;
  return copy;
}

const TARGETS: ProbeTarget[] = [
  {
    id: "engine",
    name: "Roxira Factory Engine",
    port: ":8000",
    description: "FastAPI · Synthesize & Sandbox Orchestration",
    url: process.env.NEXT_PUBLIC_ENGINE_HEALTH_URL ?? "/health",
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

function BuildProgress({ status }: { status: FactoryBuildStatus }) {
  const currentIndex = PIPELINE_STAGES.findIndex((entry) => entry.key === status.stage);
  const failed = status.stage === "FAILED" || status.stage === "REJECTED";
  const deployedUrl = status.url ?? (status.subdomain ? `http://${status.subdomain}` : null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
        <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
          app_id: <span className="text-white">{status.app_id}</span>
        </span>
        {typeof status.host_port === "number" && (
          <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
            port: <span className="text-white">{status.host_port}</span>
          </span>
        )}
        {status.container_id && (
          <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-slate-400">
            container: {status.container_id.slice(0, 12)}
          </span>
        )}
        {deployedUrl && (
          <a
            href={deployedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/20"
          >
            <ExternalLink className="size-3" />
            {status.subdomain ?? deployedUrl}
          </a>
        )}
      </div>

      <ol className="space-y-2">
        {PIPELINE_STAGES.map((entry, index) => {
          const done = !failed && currentIndex >= index;
          const active = !failed && currentIndex === index;
          return (
            <li key={entry.key} className="flex items-center gap-3">
              {active ? (
                <Loader2 className="size-4 animate-spin text-amber-300" />
              ) : done ? (
                <CheckCircle2 className="size-4 text-emerald-400" />
              ) : (
                <Circle className="size-4 text-slate-700" />
              )}
              <span
                className={`font-mono text-[11px] ${
                  active ? "text-amber-200" : done ? "text-slate-200" : "text-slate-600"
                }`}
              >
                {entry.key}
              </span>
              <span className="text-[11px] text-slate-500">{entry.label}</span>
            </li>
          );
        })}
      </ol>

      {failed && status.error && (
        <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-200">
          {status.error}
        </p>
      )}
    </div>
  );
}

export default function MissionControlPage() {
  const [results, setResults] = useState<Record<string, ProbeResult>>(INITIAL_RESULTS);
  const [refreshing, setRefreshing] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [prompt, setPrompt] = useState("");
  const [framework, setFramework] = useState("FastAPI");
  const [buildTier, setBuildTier] = useState<BuildTier>("FRONTIER");
  const [submitting, setSubmitting] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [consoleError, setConsoleError] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const [activeAppId, setActiveAppId] = useState<string | null>(null);
  const [buildStatus, setBuildStatus] = useState<FactoryBuildStatus | null>(null);
  const [history, setHistory] = useState<SandboxHistoryEntry[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historySource, setHistorySource] = useState<"remote" | "local">("local");
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [teardownError, setTeardownError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [filter, setFilter] = useState<SandboxFilter>("all");
  const [rebuilding, setRebuilding] = useState<Record<string, boolean>>({});
  const [rebuildError, setRebuildError] = useState<string | null>(null);

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
    setBuildStatus(null);
    setActiveAppId(null);
    try {
      const res = await fetch(FACTORY_SYNTHESIZE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed, target_framework: framework, tier: buildTier }),
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
      const record = (parsed ?? {}) as Partial<FactoryBuildStatus>;
      if (typeof record.app_id === "string" && record.app_id) {
        setBuildStatus({
          app_id: record.app_id,
          stage: typeof record.stage === "string" ? record.stage : "QUEUED",
          status: typeof record.status === "string" ? record.status : "QUEUED",
          app_name: record.app_name ?? null,
          stages: [],
        });
        setActiveAppId(record.app_id);
      } else {
        setOutput(formatUnknown(parsed));
      }
      setLastRunAt(Date.now());
    } catch (error) {
      setConsoleError(error instanceof Error ? error.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }, [prompt, framework, buildTier, submitting]);

  useEffect(() => {
    if (!activeAppId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const tick = async () => {
      try {
        const res = await fetch(
          `${FACTORY_BASE}/synthesize-app/${encodeURIComponent(activeAppId)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!res.ok) {
          if (res.status === 404 || res.status === 410) stop();
          return;
        }
        const data = (await res.json()) as FactoryBuildStatus;
        setBuildStatus(data);
        if (TERMINAL_STAGES.has(data.stage)) {
          stop();
          controller.abort();
        }
      } catch {
        // transient network error — keep polling until a terminal stage
      }
    };
    void tick();
    timer = setInterval(() => void tick(), 1500);
    return () => {
      stop();
      controller.abort();
    };
  }, [activeAppId]);

  const refreshSandboxes = useCallback(async () => {
    let remote: SandboxHistoryEntry[] | null = null;
    try {
      const res = await fetch(`${FACTORY_BASE}/sandboxes`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as unknown;
        const rows = Array.isArray(data) ? (data as SandboxSummary[]) : [];
        remote = rows
          .filter((row) => row !== null && typeof row === "object" && typeof row.app_id === "string")
          .map(toHistoryEntry)
          .slice(0, HISTORY_LIMIT);
      }
    } catch {
      remote = null;
    }
    if (remote && remote.length > 0) {
      setHistory(remote);
      setHistorySource("remote");
    } else {
      setHistory(loadHistory());
      setHistorySource("local");
    }
    setHistoryReady(true);
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      void refreshSandboxes();
    }, 0);
    return () => clearTimeout(kickoff);
  }, [refreshSandboxes]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      void refreshSandboxes();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshSandboxes]);

  useEffect(() => {
    if (!historyReady) return;
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // storage unavailable (private mode / quota) — history stays in memory
    }
  }, [history, historyReady]);

  useEffect(() => {
    if (!historyReady || !buildStatus) return;
    const timer = setTimeout(() => {
      setHistory((prev) => upsertHistory(prev, buildStatus));
    }, 0);
    return () => clearTimeout(timer);
  }, [buildStatus, historyReady]);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const copySubdomain = useCallback(async (appId: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(appId);
      window.setTimeout(() => {
        setCopiedId((current) => (current === appId ? null : current));
      }, 1500);
    } catch {
      setCopiedId(null);
    }
  }, []);

  const rebuild = useCallback(async (appId: string) => {
    setRebuilding((prev) => ({ ...prev, [appId]: true }));
    setRebuildError(null);
    try {
      const detailRes = await fetch(
        `${FACTORY_BASE}/synthesize-app/${encodeURIComponent(appId)}`,
        { cache: "no-store" },
      );
      if (!detailRes.ok) throw new Error(`detail HTTP ${detailRes.status}`);
      const detail = (await detailRes.json()) as FactoryBuildStatus;
      const specification = (detail.prompt ?? "").trim();
      if (!specification) throw new Error("previous prompt unavailable");

      const submitRes = await fetch(FACTORY_SYNTHESIZE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: detail.app_id,
          app_name: detail.app_name ?? detail.app_id,
          specification,
          target_framework: detail.target_framework ?? "FastAPI",
          tier: detail.tier ?? "STANDARD",
        }),
      });
      if (!submitRes.ok) throw new Error(`HTTP ${submitRes.status}`);

      const data = (await submitRes.json().catch(() => null)) as
        | { app_id?: string; stage?: string; status?: string }
        | null;
      const nextId = data?.app_id ?? appId;
      setBuildStatus({
        app_id: nextId,
        stage: data?.stage ?? "QUEUED",
        status: data?.status ?? "QUEUED",
        app_name: detail.app_name ?? null,
        stages: [],
      });
      setActiveAppId(nextId);
    } catch (error) {
      setRebuildError(error instanceof Error ? error.message : "rebuild failed");
    } finally {
      setRebuilding((prev) => {
        const copy = { ...prev };
        delete copy[appId];
        return copy;
      });
    }
  }, []);

  const teardown = useCallback(
    async (appId: string) => {
      setDeleting((prev) => ({ ...prev, [appId]: true }));
      setTeardownError(null);
      try {
        const res = await fetch(`${FACTORY_BASE}/sandboxes/${encodeURIComponent(appId)}`, {
          method: "DELETE",
          cache: "no-store",
        });
        if (res.status === 404) {
          setHistory((prev) => prev.filter((entry) => entry.app_id !== appId));
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json().catch(() => null)) as SandboxSummary | null;
        if (data && typeof data.app_id === "string") {
          setHistory((prev) => upsertHistory(prev, data));
        } else {
          setHistory((prev) => prev.filter((entry) => entry.app_id !== appId));
        }
        if (activeAppId === appId) {
          setActiveAppId(null);
          setBuildStatus(null);
        }
      } catch (error) {
        setTeardownError(error instanceof Error ? error.message : "request failed");
      } finally {
        setDeleting((prev) => {
          const copy = { ...prev };
          delete copy[appId];
          return copy;
        });
      }
    },
    [activeAppId],
  );

  const visibleHistory = history.filter((entry) => matchesFilter(entry, filter));

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
              POST {FACTORY_SYNTHESIZE_ENDPOINT}
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

              <div>
                <span className="font-mono text-[10px] text-slate-500">BUILD TIER</span>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {BUILD_TIERS.map((tier) => {
                    const active = buildTier === tier.id;
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => setBuildTier(tier.id)}
                        aria-pressed={active}
                        className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                          active
                            ? "border-amber-400/50 bg-amber-400/10"
                            : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                        }`}
                      >
                        <span
                          className={`block font-mono text-[11px] font-bold ${
                            active ? "text-amber-200" : "text-slate-300"
                          }`}
                        >
                          {tier.name}
                        </span>
                        <span className="mt-0.5 block font-mono text-[9px] text-slate-500">
                          {tier.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
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

          {(buildStatus || output || consoleError || submitting) && (
            <div className="mt-5 rounded-xl border border-slate-800/80 bg-slate-950/80 p-4">
              <div className="mb-2 flex items-center gap-2 font-mono text-[10px]">
                {buildStatus ? (
                  <>
                    {buildStatus.stage === "FAILED" || buildStatus.stage === "REJECTED" ? (
                      <XCircle className="size-3.5 text-rose-400" />
                    ) : buildStatus.stage === "RUNNING" ? (
                      <CheckCircle2 className="size-3.5 text-emerald-400" />
                    ) : (
                      <Loader2 className="size-3.5 animate-spin text-amber-300" />
                    )}
                    <span className="text-slate-300">BUILD {buildStatus.stage}</span>
                  </>
                ) : consoleError ? (
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
              {buildStatus ? (
                <BuildProgress status={buildStatus} />
              ) : (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">
                  {consoleError ?? output ?? "…"}
                </pre>
              )}
            </div>
          )}
        </section>

        <section className="mt-8 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/70 pb-4">
            <div className="flex items-center gap-2.5">
              <Boxes className="size-4 text-amber-300" />
              <h2 className="font-mono text-sm font-bold tracking-wider text-slate-100">
                RECENT SYNTHESIZED SANDBOXES
              </h2>
              <span
                className={`rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                  historySource === "remote"
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                    : "border-slate-700 bg-slate-800/50 text-slate-400"
                }`}
                title={
                  historySource === "remote"
                    ? "Live deployments from the factory API"
                    : "Cached locally — factory API unavailable"
                }
              >
                {historySource === "remote" ? "LIVE" : "LOCAL"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAutoRefresh((prev) => !prev)}
                aria-pressed={autoRefresh}
                title={autoRefresh ? "Auto-refresh every 5s is on" : "Turn on auto-refresh (5s)"}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[10px] transition-colors ${
                  autoRefresh
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                    : "border-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                <RefreshCw className={`size-3 ${autoRefresh ? "animate-spin" : ""}`} />
                AUTO 5s
              </button>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 font-mono text-[10px] text-slate-400 transition-colors hover:border-rose-400/40 hover:text-rose-300"
                >
                  <Trash2 className="size-3" />
                  CLEAR
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {SANDBOX_FILTERS.map((option) => {
              const count =
                option.id === "all"
                  ? history.length
                  : history.filter((entry) => matchesFilter(entry, option.id)).length;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  aria-pressed={filter === option.id}
                  className={`rounded-lg border px-3 py-1.5 font-mono text-[10px] transition-colors ${
                    filter === option.id
                      ? "border-indigo-400/40 bg-indigo-400/10 text-indigo-200"
                      : "border-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  {option.label} ({count})
                </button>
              );
            })}
          </div>

          {teardownError && (
            <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 font-mono text-[10px] text-rose-200">
              teardown failed — {teardownError}
            </p>
          )}

          {rebuildError && (
            <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 font-mono text-[10px] text-rose-200">
              rebuild failed — {rebuildError}
            </p>
          )}

          {visibleHistory.length === 0 ? (
            <p className="mt-4 font-mono text-[11px] text-slate-600">
              {history.length === 0
                ? "No sandboxes yet — run a synthesis above to populate this list."
                : "No sandboxes match this filter."}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-800/70">
              {visibleHistory.map((entry) => {
                const badgeClass = SANDBOX_BADGE[entry.stage] ?? SANDBOX_BADGE_DEFAULT;
                const link = entry.url ?? (entry.subdomain ? `http://${entry.subdomain}` : null);
                const isDeleting = Boolean(deleting[entry.app_id]);
                const healthKey = (entry.health ?? classifyFromStage(entry.stage)).toUpperCase();
                const healthTone = HEALTH_STYLES[healthKey] ?? HEALTH_STYLES.STARTING;
                const isActive = Boolean(entry.container_id) || entry.stage === "RUNNING";
                const copied = copiedId === entry.app_id;
                const isRebuilding = Boolean(rebuilding[entry.app_id]);
                const swarmStatus = entry.swarm_status ?? null;
                const isSwarm =
                  isSwarmTier(entry.tier) || Boolean(swarmStatus) || entry.swarm_qa_score != null;
                const qa = qaPercent(entry.swarm_qa_score);
                return (
                  <li key={entry.app_id} className="py-3">
                    <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-xs font-semibold text-slate-100">
                      {entry.app_id}
                    </span>

                    <span
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px]"
                      title={isActive ? "Live container telemetry" : "Build telemetry"}
                    >
                      <span className="relative flex size-1.5">
                        <span
                          className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                            isActive ? "animate-ping" : ""
                          } ${healthTone.dot}`}
                        />
                        <span className={`relative inline-flex size-1.5 rounded-full ${healthTone.dot}`} />
                      </span>
                      <span className={healthTone.text}>{healthTone.label}</span>
                    </span>

                    <span
                      className={`rounded-lg border px-2 py-0.5 font-mono text-[10px] ${badgeClass}`}
                    >
                      {entry.stage}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {entry.host_port === null ? "port —" : `port ${entry.host_port}`}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      {link ? (
                        <>
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/20"
                          >
                            <ExternalLink className="size-3" />
                            {entry.subdomain ?? link}
                          </a>
                          <button
                            type="button"
                            onClick={() => void copySubdomain(entry.app_id, entry.subdomain ?? link)}
                            title="Copy subdomain"
                            aria-label="Copy subdomain"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2 py-1 font-mono text-[10px] text-slate-400 transition-colors hover:border-slate-700 hover:text-white"
                          >
                            {copied ? (
                              <Check className="size-3 text-emerald-400" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                            {copied ? "COPIED" : "COPY"}
                          </button>
                        </>
                      ) : (
                        <span className="font-mono text-[10px] text-slate-600">
                          no subdomain yet
                        </span>
                      )}

                      {(entry.stage === "FAILED" || entry.stage === "REJECTED") && (
                        <button
                          type="button"
                          onClick={() => void rebuild(entry.app_id)}
                          disabled={isRebuilding}
                          aria-busy={isRebuilding}
                          title="Rebuild with the previous prompt"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-amber-200 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isRebuilding ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <RefreshCw className="size-3" />
                          )}
                          {isRebuilding ? "REBUILDING…" : "REBUILD"}
                        </button>
                      )}

                      {entry.stage !== "DESTROYED" && (
                        <button
                          type="button"
                          onClick={() => void teardown(entry.app_id)}
                          disabled={isDeleting}
                          aria-busy={isDeleting}
                          title="Teardown sandbox"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1 font-mono text-[10px] text-slate-400 transition-colors hover:border-rose-400/40 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isDeleting ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Trash2 className="size-3" />
                          )}
                          {isDeleting ? "TEARDOWN…" : "TEARDOWN"}
                        </button>
                      )}
                    </span>
                    </div>

                    {isSwarm && (
                      <div className="mt-3 rounded-2xl border border-violet-400/25 bg-violet-500/[0.04] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Users className="size-4 text-violet-300" />
                            <h3 className="font-mono text-[11px] font-bold tracking-wider text-violet-200">
                              AUTONOMOUS SWARM BREAKDOWN
                            </h3>
                          </div>
                          <span
                            className="rounded-md border border-violet-400/25 bg-violet-400/10 px-2 py-0.5 font-mono text-[9px] font-bold text-violet-200"
                            dir="ltr"
                          >
                            {swarmStatus ?? "PENDING"}
                          </span>
                        </div>

                        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center">
                          <ol className="flex-1 space-y-2">
                            {SWARM_TEAMS.map((team) => {
                              const state = swarmTeamState(team, swarmStatus);
                              const tone = SWARM_STATE_STYLES[state];
                              return (
                                <li
                                  key={team.stage}
                                  className="flex items-center gap-3 rounded-xl border border-slate-800/70 bg-slate-950/50 px-3 py-2.5"
                                >
                                  <span className="text-base leading-none" aria-hidden="true">
                                    {team.icon}
                                  </span>
                                  <span className="flex min-w-0 flex-col">
                                    <span className="truncate font-mono text-[11px] font-semibold text-slate-200">
                                      {team.name}
                                    </span>
                                    <span className="truncate font-mono text-[9px] text-slate-500">
                                      {team.role}
                                    </span>
                                  </span>
                                  <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px]">
                                    {state === "active" ? (
                                      <Loader2 className="size-3 animate-spin text-amber-300" />
                                    ) : (
                                      <span className={`size-1.5 rounded-full ${tone.dot}`} />
                                    )}
                                    <span className={tone.text}>{tone.label}</span>
                                  </span>
                                </li>
                              );
                            })}
                          </ol>

                          {qa !== null && (
                            <div className="flex shrink-0 flex-col items-center gap-2 self-center">
                              <div
                                className="relative flex size-24 items-center justify-center rounded-full"
                                style={{
                                  background: `conic-gradient(#34d399 ${qa * 3.6}deg, rgba(148,163,184,0.15) 0deg)`,
                                }}
                              >
                                <div className="flex size-[76px] flex-col items-center justify-center rounded-full bg-slate-950">
                                  <span className="font-mono text-lg font-black text-emerald-300">
                                    {qa}%
                                  </span>
                                  <span className="font-mono text-[8px] text-slate-500">
                                    CONFORMANCE
                                  </span>
                                </div>
                              </div>
                              <span className="font-mono text-[10px] text-slate-500">QA Score</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
