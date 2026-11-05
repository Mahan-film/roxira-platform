"use client";

import { useEffect, useState } from "react";

import { getBulkConfig } from "@/lib/api/bulk-import-client";
import { listImportFormats } from "@/lib/api/data-import-suite-client";
import { FALLBACK_ACCEPT, acceptFromFormats } from "@/lib/import-routing";

interface ImportLimits {
  /** The file picker's `accept`, built from the server's support matrix. */
  accept: string;
  /** Whether the server has the bulk streaming import (files over 5 MB) enabled. */
  bulkEnabled: boolean;
}

let cached: Promise<ImportLimits> | null = null;

/** Read once per page load; both import tabs share it. A failed read keeps the static fallback. */
function loadLimits(): Promise<ImportLimits> {
  cached ??= Promise.all([
    listImportFormats()
      .then(acceptFromFormats)
      .catch(() => FALLBACK_ACCEPT),
    getBulkConfig()
      .then((config) => config.enabled)
      .catch(() => false),
  ]).then(([accept, bulkEnabled]) => ({ accept, bulkEnabled }));
  cached.then((limits) => {
    // Retry on the next mount when the server was not reachable for formats or bulk-config.
    if (limits.accept === FALLBACK_ACCEPT || !limits.bulkEnabled) cached = null;
  });
  return cached;
}

export function useImportLimits(): ImportLimits {
  const [limits, setLimits] = useState<ImportLimits>({ accept: FALLBACK_ACCEPT, bulkEnabled: false });
  useEffect(() => {
    let alive = true;
    void loadLimits().then((next) => {
      if (alive) setLimits(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return limits;
}
