"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiClientError } from "@/lib/api/http-client";

export const SELECT_CLASS =
  "h-10 rounded-lg border border-border bg-background px-2 text-sm text-foreground disabled:opacity-60";

export function errorText(error: unknown): string {
  if (error instanceof ApiClientError) return error.details.join(" ");
  return "ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کنید.";
}

/** Load data on mount and whenever `reload()` is called. */
export function useLoad<T>(fetcher: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetcher(controller.signal)
      .then((value) => {
        setData(value);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(errorText(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload };
}

/** Run a mutation, surface its error, and reload on success. */
export function useAction(onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setError(null);
      setBusy(true);
      try {
        const result = await fn();
        onDone();
        return result;
      } catch (err) {
        setError(errorText(err));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [onDone],
  );
  return { run, error, busy, clearError: () => setError(null) };
}
