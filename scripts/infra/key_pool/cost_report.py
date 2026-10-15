#!/usr/bin/env python3
"""Daily cost/latency report from the gateway's requests.jsonl (see cost_logger.py).

Usage: cost_report.py [--file FILE] [--today] [--days N] [--short]

  --file FILE  JSONL written by cost_logger (default $KEYPOOL_COST_LOG or
               /var/log/roxira-keypool/requests.jsonl).
  --today      only the current UTC day.
  --days N     only the last N days (UTC).
  --short      at most 12 lines (for the owner's bot).

Prints, per model group: calls, success %, total cost (USD), cost per successful call and
p50/p95 latency; then the top 5 deployment ids by cost. Reads only; never prints prompts.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

DEFAULT_REPORT_PATH = "/var/log/roxira-keypool/requests.jsonl"
SHORT_MAX_LINES = 12


def report_path() -> Path:
    return Path(os.environ.get("KEYPOOL_COST_LOG") or DEFAULT_REPORT_PATH)


def _parse_ts(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def load_records(
    path: str | os.PathLike[str] | None = None,
    today: bool = False,
    days: int | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Read the JSONL, skipping unreadable lines, then apply the optional UTC window."""
    src = Path(path or report_path())
    now = now or datetime.now(timezone.utc)
    out: list[dict[str, Any]] = []
    try:
        lines = src.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return out
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if not isinstance(rec, dict):
            continue
        if today or days:
            ts = _parse_ts(rec.get("ts"))
            if ts is None:
                continue
            if today and ts.date() != now.date():
                continue
            if days and ts < now - timedelta(days=days):
                continue
        out.append(rec)
    return out


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (len(ordered) - 1) * pct
    lo = math.floor(rank)
    hi = math.ceil(rank)
    if lo == hi:
        return float(ordered[lo])
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (rank - lo)


def _cost(rec: dict[str, Any]) -> float:
    try:
        value = float(rec.get("response_cost") or 0.0)
    except (TypeError, ValueError):
        return 0.0
    return value if math.isfinite(value) and value > 0 else 0.0


def _latency(rec: dict[str, Any]) -> float:
    try:
        return max(0.0, float(rec.get("latency_ms") or 0.0))
    except (TypeError, ValueError):
        return 0.0


def aggregate(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Group totals plus the top 5 deployments by cost."""
    by_group: dict[str, list[dict[str, Any]]] = {}
    for rec in records:
        by_group.setdefault(str(rec.get("model_group") or "unknown"), []).append(rec)

    groups = []
    for name in sorted(by_group):
        recs = by_group[name]
        calls = len(recs)
        ok = sum(1 for r in recs if r.get("success"))
        total_cost = sum(_cost(r) for r in recs)
        latencies = [_latency(r) for r in recs]
        groups.append({
            "group": name,
            "calls": calls,
            "success": ok,
            "success_pct": (100.0 * ok / calls) if calls else 0.0,
            "total_cost": total_cost,
            "cost_per_success": (total_cost / ok) if ok else 0.0,
            "p50": percentile(latencies, 0.50),
            "p95": percentile(latencies, 0.95),
        })

    by_dep: dict[str, float] = {}
    for rec in records:
        by_dep[str(rec.get("deployment") or "unknown")] = by_dep.get(
            str(rec.get("deployment") or "unknown"), 0.0
        ) + _cost(rec)
    deployments = [
        {"deployment": dep, "cost": cost}
        for dep, cost in sorted(by_dep.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
    ]
    return {
        "calls": len(records),
        "success": sum(1 for r in records if r.get("success")),
        "total_cost": sum(_cost(r) for r in records),
        "groups": groups,
        "deployments": deployments,
    }


def format_report(agg: dict[str, Any], source: str, short: bool = False) -> str:
    calls = agg["calls"]
    ok = agg["success"]
    pct = (100.0 * ok / calls) if calls else 0.0
    lines = [
        f"keypool cost: {calls} calls, {ok} ok ({pct:.1f}%), "
        f"${agg['total_cost']:.6f} total [{source}]",
    ]
    for g in agg["groups"]:
        lines.append(
            f"{g['group']:<22} calls {g['calls']:>4}  ok {g['success_pct']:>5.1f}%  "
            f"${g['total_cost']:.6f}  ${g['cost_per_success']:.6f}/ok  "
            f"p50 {g['p50']:.0f}ms  p95 {g['p95']:.0f}ms"
        )
    if agg["deployments"]:
        lines.append("top deployments by cost:")
        for rank, dep in enumerate(agg["deployments"], start=1):
            lines.append(f"  {rank}. {dep['deployment']}  ${dep['cost']:.6f}")
    if short:
        lines = lines[:SHORT_MAX_LINES]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Key-pool cost/latency report from requests.jsonl.")
    ap.add_argument("--file", default=None, help="requests.jsonl (default $KEYPOOL_COST_LOG)")
    ap.add_argument("--today", action="store_true", help="only the current UTC day")
    ap.add_argument("--days", type=int, default=None, help="only the last N days")
    ap.add_argument("--short", action="store_true", help="at most 12 lines")
    args = ap.parse_args(argv)
    src = Path(args.file or report_path())
    records = load_records(src, today=args.today, days=args.days)
    print(format_report(aggregate(records), str(src), short=args.short))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
