"use client";

/**
 * Small presentational pieces + one data hook shared by every admin-console tab.
 * Colours come only from the `.ghazi-theme` tokens (--gh-*): navy background, gold primary, cyan accents.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { adminGet, AdminApiError } from "@/lib/api/admin-console-client";

export function fa(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("fa-IR", { maximumFractionDigits: digits });
}

export function when(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  const d = typeof iso === "number" ? new Date(iso * 1000) : new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-[var(--gh-border)] bg-[var(--gh-surface)] p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-[var(--gh-gold)]">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "text" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "text" | "gold" | "cyan" | "ok" | "danger" }) {
  const color = { text: "text-[var(--gh-text)]", gold: "text-[var(--gh-gold)]", cyan: "text-[var(--gh-cyan)]", ok: "text-[var(--gh-ok)]", danger: "text-[var(--gh-danger)]" }[tone];
  return (
    <div className="rounded-xl border border-[var(--gh-border)] bg-[var(--gh-bg-2)] p-3">
      <div className="text-xs text-[var(--gh-muted)]">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-[var(--gh-muted)]">{hint}</div>}
    </div>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "danger" | "cyan" }) {
  const color = {
    muted: "border-[var(--gh-border)] text-[var(--gh-muted)]",
    ok: "border-[var(--gh-ok)] text-[var(--gh-ok)]",
    warn: "border-[var(--gh-gold)] text-[var(--gh-gold)]",
    danger: "border-[var(--gh-danger)] text-[var(--gh-danger)]",
    cyan: "border-[var(--gh-cyan)] text-[var(--gh-cyan)]",
  }[tone];
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${color}`}>{children}</span>;
}

export function Btn({
  children, onClick, disabled, variant = "primary", type = "button", small,
}: { children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "ghost" | "danger"; type?: "button" | "submit"; small?: boolean }) {
  const base = small ? "min-h-9 px-3 text-xs" : "min-h-11 px-4 text-sm";
  const look = {
    primary: "bg-[var(--gh-gold)] text-[var(--gh-on-gold)] hover:bg-[var(--gh-gold-strong)] border-transparent",
    ghost: "bg-[var(--gh-surface)] text-[var(--gh-text)] border-[var(--gh-border-strong)] hover:border-[var(--gh-cyan)]",
    danger: "bg-transparent text-[var(--gh-danger)] border-[var(--gh-danger)] hover:bg-[var(--gh-surface-2)]",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${base} ${look}`}>
      {children}
    </button>
  );
}

const FIELD = "w-full min-h-11 rounded-xl border border-[var(--gh-border-strong)] bg-[var(--gh-bg-2)] px-3 text-sm text-[var(--gh-text)] placeholder:text-[var(--gh-muted)]";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-[var(--gh-muted)]">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[var(--gh-muted)]">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD} ${props.className ?? ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${FIELD} py-2 ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD} ${props.className ?? ""}`} />;
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "danger" | "ok" | "info"; children: ReactNode }) {
  const color = {
    warn: "border-[var(--gh-gold)] text-[var(--gh-gold)]",
    danger: "border-[var(--gh-danger)] text-[var(--gh-danger)]",
    ok: "border-[var(--gh-ok)] text-[var(--gh-ok)]",
    info: "border-[var(--gh-cyan)] text-[var(--gh-cyan)]",
  }[tone];
  return <div role={tone === "danger" ? "alert" : "status"} className={`rounded-xl border bg-[var(--gh-bg-2)] p-3 text-sm ${color}`}>{children}</div>;
}

/** Horizontally scrollable table wrapper (mobile). */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--gh-border)]">
      <table className="w-full min-w-[640px] text-right text-xs sm:text-sm">{children}</table>
    </div>
  );
}

export function Th({ children }: { children?: ReactNode }) {
  return <th className="whitespace-nowrap border-b border-[var(--gh-border)] bg-[var(--gh-bg-2)] px-3 py-2 font-medium text-[var(--gh-muted)]">{children}</th>;
}

export function Td({ children, mono, className = "" }: { children?: ReactNode; mono?: boolean; className?: string }) {
  return <td className={`border-b border-[var(--gh-border)] px-3 py-2 align-top ${mono ? "font-mono text-[11px]" : ""} ${className}`} dir={mono ? "ltr" : undefined}>{children}</td>;
}

export function Spinner({ label = "در حال بارگذاری…" }: { label?: string }) {
  return <div className="p-4 text-sm text-[var(--gh-muted)]" role="status">{label}</div>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "خطای نامشخص";
  return (
    <Notice tone="danger">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{msg}</span>
        {onRetry && <Btn small variant="ghost" onClick={onRetry}>تلاش دوباره</Btn>}
      </div>
    </Notice>
  );
}

export interface QueryState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** GET once on mount (and whenever `key` changes) + a manual reload. A 401 calls `onAuthLost`. */
export function useAdminData<T>(path: string, params: Record<string, string | number | undefined | null> | undefined, onAuthLost: () => void, key = ""): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const paramsRef = useRef(params);
  const lostRef = useRef(onAuthLost);
  const seq = useRef(0);
  useEffect(() => {
    paramsRef.current = params;
    lostRef.current = onAuthLost;
  });

  // All setState calls happen after an await (never synchronously inside the effect that starts the fetch).
  const fetchNow = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const result = await adminGet<T>(path, paramsRef.current);
      if (mine !== seq.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      if (e instanceof AdminApiError && e.status === 401) lostRef.current();
      setError(e);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void fetchNow();
  }, [fetchNow, key]);

  const reload = useCallback(() => {
    setLoading(true);
    void fetchNow();
  }, [fetchNow]);

  return { data, error, loading, reload };
}

/** Run a mutation with busy / result / error state. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, onAuthLost: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (...args: A): Promise<R | null> => {
      setBusy(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        if (e instanceof AdminApiError && e.status === 401) onAuthLost();
        setError(e instanceof Error ? e.message : "خطای نامشخص");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fn, onAuthLost],
  );
  return { run, busy, error, clearError: () => setError(null) };
}
