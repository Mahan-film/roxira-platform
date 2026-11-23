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

# Rust Hot-Path Gate policy constants (T308 / R33)
RUST_GATE_STAGE_SHARE_THRESHOLD_PCT: float = 30.0
RUST_GATE_PROTOTYPE_SPEEDUP_THRESHOLD: float = 2.0


def percentile(values: Sequence[float], pct: float) -> float:
    """Nearest-rank percentile (0..100) in milliseconds, rounded to 2 decimals."""
    if not values:
        return 0.0
    ordered = sorted(float(v) for v in values)
    idx = max(0, min(len(ordered) - 1, math.ceil((pct / 100.0) * len(ordered)) - 1))
    return round(ordered[idx], 2)


def summarize_stages(records: Iterable[RetrievalTimings]) -> Dict[str, Dict[str, float]]:
    """Compute p50, p95, and p95_share_pct per retrieval stage from a list of ``RetrievalTimings``."""
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

    summary: Dict[str, Dict[str, float]] = {
        stage: {"p50": percentile(vals, 50), "p95": percentile(vals, 95)}
        for stage, vals in buckets.items()
    }

    total_p95 = summary.get("total_ms", {}).get("p95", 0.0)
    for stage, stats in summary.items():
        if stage == "total_ms":
            stats["p95_share_pct"] = 100.0 if total_p95 > 0 else 0.0
        else:
            stats["p95_share_pct"] = (
                round((stats["p95"] / total_p95) * 100.0, 1) if total_p95 > 0 else 0.0
            )

    return summary


def evaluate_rust_gate(
    summary: Dict[str, Dict[str, float]],
    prototype_speedups: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """Evaluate retrieval stages against the Rust Hot-Path Gate policy (T308 / R33).

    A stage is eligible for a Rust sidecar rewrite ONLY if BOTH:
      1. Its p95 latency constitutes > 30% of total_ms p95 latency.
      2. A measured prototype in Rust proves > 2.0x speedup over baseline.

    Returns a structured dictionary with per-stage evaluations and overall verdict.
    """
    total_p95 = summary.get("total_ms", {}).get("p95", 0.0)
    prototype_speedups = prototype_speedups or {}

    stage_evals: Dict[str, Dict[str, Any]] = {}
    any_stage_exceeds_threshold = False
    eligible_for_rewrite: List[str] = []

    for stage, stats in summary.items():
        if stage == "total_ms":
            continue
        p95 = stats.get("p95", 0.0)
        share_pct = stats.get("p95_share_pct", 0.0)
        exceeds_share = share_pct > RUST_GATE_STAGE_SHARE_THRESHOLD_PCT
        speedup = float(prototype_speedups.get(stage, 1.0))
        exceeds_speedup = speedup > RUST_GATE_PROTOTYPE_SPEEDUP_THRESHOLD

        eligible = exceeds_share and exceeds_speedup
        if exceeds_share:
            any_stage_exceeds_threshold = True
        if eligible:
            eligible_for_rewrite.append(stage)

        stage_evals[stage] = {
            "p95_ms": p95,
            "p95_share_pct": share_pct,
            "exceeds_30pct_threshold": exceeds_share,
            "prototype_speedup": speedup,
            "exceeds_2x_speedup": exceeds_speedup,
            "eligible_for_rewrite": eligible,
        }

    verdict = "REWRITE_PROHIBITED" if not eligible_for_rewrite else "REWRITE_PERMITTED"
    if not any_stage_exceeds_threshold:
        reason = (
            f"No stage exceeds {RUST_GATE_STAGE_SHARE_THRESHOLD_PCT}% of p95 latency. "
            "Consuming pre-built Rust binaries (Qdrant, TEI, ruff, oxlint, orjson) remains optimal."
        )
    elif not eligible_for_rewrite:
        reason = (
            f"Stage(s) exceed {RUST_GATE_STAGE_SHARE_THRESHOLD_PCT}% latency share, "
            f"but proven prototype speedup > {RUST_GATE_PROTOTYPE_SPEEDUP_THRESHOLD}x was not demonstrated."
        )
    else:
        reason = f"Stage(s) {eligible_for_rewrite} meet all gate criteria (>30% p95 and >2x prototype speedup)."

    return {
        "gate_threshold_share_pct": RUST_GATE_STAGE_SHARE_THRESHOLD_PCT,
        "gate_threshold_speedup": RUST_GATE_PROTOTYPE_SPEEDUP_THRESHOLD,
        "total_p95_ms": total_p95,
        "stages": stage_evals,
        "eligible_stages": eligible_for_rewrite,
        "verdict": verdict,
        "reason": reason,
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


def format_report(
    summary: Dict[str, Dict[str, float]],
    gate: Optional[Dict[str, Any]] = None,
) -> str:
    lines = ["stage        p50_ms    p95_ms    p95_share_%"]
    for stage, stats in summary.items():
        share = stats.get("p95_share_pct", 0.0)
        lines.append(f"{stage:<12} {stats['p50']:>6.2f}    {stats['p95']:>6.2f}        {share:>5.1f}%")

    gate_eval = gate or evaluate_rust_gate(summary)
    lines.append("")
    lines.append("--- Rust Hot-Path Gate (T308 / R33) ---")
    lines.append(f"Threshold: stage > {gate_eval['gate_threshold_share_pct']}% of p95 AND prototype > {gate_eval['gate_threshold_speedup']}x speedup")
    lines.append(f"Verdict:   {gate_eval['verdict']}")
    lines.append(f"Reason:    {gate_eval['reason']}")
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Smart Judge retrieval replay benchmark")
    parser.add_argument("--offline", action="store_true", help="Use deterministic offline mock backend")
    parser.add_argument("--runs", type=int, default=3, help="Number of passes over query set")
    parser.add_argument("--json", action="store_true", help="Print JSON summary")
    parser.add_argument("--check-gate", action="store_true", help="Verify against Rust Hot-Path Gate (T308)")
    parser.add_argument(
        "--prototype-speedup",
        action="append",
        default=[],
        help="Proven prototype speedup as STAGE=SPEEDUP (e.g. qdrant_ms=2.5)",
    )
    args = parser.parse_args(argv)

    prototype_speedups: Dict[str, float] = {}
    for item in args.prototype_speedup:
        if "=" in item:
            stage_name, val_str = item.split("=", 1)
            try:
                prototype_speedups[stage_name.strip()] = float(val_str.strip())
            except ValueError:
                pass

    if args.offline:
        backend: RetrievalBackend = _OfflineMockBackend()
    else:
        from output_apps.generated_modules.smartjudge import smartjudge_module as sm
        from output_apps.generated_modules.smartjudge.retrieval_contract import LocalRetrievalBackend

        backend = LocalRetrievalBackend(sm.aquery_knowledge_graph)

    summary = asyncio.run(run_benchmark(backend, runs=args.runs))
    gate_eval = evaluate_rust_gate(summary, prototype_speedups=prototype_speedups)

    if args.json:
        payload = {
            "summary": summary,
            "rust_gate": gate_eval,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(format_report(summary, gate=gate_eval))

    if args.check_gate and gate_eval["verdict"] == "REWRITE_PROHIBITED":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
