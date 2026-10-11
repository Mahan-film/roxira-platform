import { readFileSync } from "node:fs";
import { join } from "node:path";

export type CoverageTotals = { laws: number; articles: number };

/** Server-only: public coverage numbers come from the same manifest as /coverage. */
export function loadCoverageTotals(): CoverageTotals {
  const raw = readFileSync(join(process.cwd(), "public", "coverage_manifest.json"), "utf-8");
  const { totals } = JSON.parse(raw) as { totals: CoverageTotals };
  return { laws: totals.laws, articles: totals.articles };
}
