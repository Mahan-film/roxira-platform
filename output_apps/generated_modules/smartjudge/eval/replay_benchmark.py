"""Replay benchmark for Smart Judge retrieval hot path (prints per-stage p50/p95).

Usage:
  python3 -m output_apps.generated_modules.smartjudge.eval.replay_benchmark --offline
  python3 -m output_apps.generated_modules.smartjudge.eval.replay_benchmark --runs 20
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import time
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Sequence

from output_apps.generated_modules.smartjudge.retrieval_contract import (
    LawHit,
    PrecedentHit,
    RetrievalBackend,
    RetrievalRequest,
    RetrievalResponse,
    RetrievalTimings,
)

DEFAULT_QUERIES: List[str] = [
    "مهلت تجدیدنظرخواهی در دعاوی حقوقی چقدر است؟",
    "شرایط فسخ قرارداد اجاره به دلیل تخلف مستاجر چیست؟",
    "مطالبه مهریه از طریق اجرای ثبت چه مراحلی دارد؟",
    "مسئولیت کارفرما در حوادث ناشی از کار چگونه تعیین می‌شود؟",
    "چک برگشتی و صدور اجراییه مستقیم بر اساس قانون جدید چک",
]


def percentile(values: Sequence[float], pct: float) -> float:
    """Nearest-rank percentile (0..100) in milliseconds, rounded to 2 decimals."""
    if not values:
        return 0.0
    ordered = sorted(float(v) for v in values)
    idx = max(0, min(len(ordered) - 1, math.ceil((pct / 100.0) * len(ordered)) - 1))
    return round(ordered[idx], 2)


def summarize_stages(records: Iterable[RetrievalTimings]) -> Dict[str, Dict[str, float]]:
    """Compute p50 and p95 per retrieval stage from a list of ``RetrievalTimings``."""
    buckets: Dict[str, List[float]] = {
        "embed_ms": [],
        "qdrant_ms": [],
        "sql_ms": [],
        "rulings_ms": [],
        "regs_ms": [],
        "total_ms": [],
    }
    for rec in records:
        for stage in buckets:
            buckets[stage].append(float(getattr(rec, stage, 0.0)))
    return {
        stage: {"p50": percentile(vals, 50), "p95": percentile(vals, 95)}
        for stage, vals in buckets.items()
    }


class _OfflineMockBackend:
    """Deterministic in-memory backend for offline CI/regression benchmarking."""

    async def retrieve(self, request: RetrievalRequest) -> RetrievalResponse:
        t0 = time.perf_counter()
        await asyncio.sleep(0)
        total_ms = round((time.perf_counter() - t0) * 1000.0, 3)
        return RetrievalResponse(
            laws=[LawHit(title=f"ماده ۱ ({request.query[:12]})", summary="متن آزمایشی", match_level="EXACT")],
            precedents=[PrecedentHit(title="رأی وحدت رویه نمونه", summary="خلاصه آزمایشی")],
            source="offline-mock",
            timings=RetrievalTimings(
                embed_ms=0.2,
                qdrant_ms=0.4,
                sql_ms=0.3,
                rulings_ms=0.1,
                regs_ms=0.1,
                total_ms=max(total_ms, 0.5),
            ),
        )


async def run_benchmark(
    backend: RetrievalBackend,
    queries: Sequence[str] = DEFAULT_QUERIES,
    *,
    runs: int = 1,
) -> Dict[str, Dict[str, float]]:
    """Replay ``queries`` ``runs`` times against ``backend`` and return per-stage p50/p95."""
    timings: List[RetrievalTimings] = []
    for _ in range(max(1, runs)):
        for q in queries:
            t0 = time.perf_counter()
            resp = await backend.retrieve(RetrievalRequest(query=q, limit=5))
            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
            t = resp.timings
            if t.total_ms <= 0:
                t = t.model_copy(update={"total_ms": elapsed_ms})
            timings.append(t)
    return summarize_stages(timings)


def format_report(summary: Dict[str, Dict[str, float]]) -> str:
    lines = ["stage        p50_ms    p95_ms"]
    for stage, stats in summary.items():
        lines.append(f"{stage:<12} {stats['p50']:>6.2f}    {stats['p95']:>6.2f}")
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Smart Judge retrieval replay benchmark")
    parser.add_argument("--offline", action="store_true", help="Use deterministic offline mock backend")
    parser.add_argument("--runs", type=int, default=3, help="Number of passes over query set")
    parser.add_argument("--json", action="store_true", help="Print JSON summary")
    args = parser.parse_args(argv)

    if args.offline:
        backend: RetrievalBackend = _OfflineMockBackend()
    else:
        from output_apps.generated_modules.smartjudge import smartjudge_module as sm
        from output_apps.generated_modules.smartjudge.retrieval_contract import LocalRetrievalBackend

        backend = LocalRetrievalBackend(sm.aquery_knowledge_graph)

    summary = asyncio.run(run_benchmark(backend, runs=args.runs))
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(format_report(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
