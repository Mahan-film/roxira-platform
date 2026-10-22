"use client";

import { useEffect } from "react";

import { installClientErrorReporter } from "@/lib/observability/client-error-reporter";

/** Mounts the window error / unhandledrejection listeners (idempotent per page load). */
export function ClientErrorReporter() {
  useEffect(() => installClientErrorReporter(), []);
  return null;
}
