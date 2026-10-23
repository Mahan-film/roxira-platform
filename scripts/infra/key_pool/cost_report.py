#!/usr/bin/env python3
"""Daily cost/latency report from the gateway's requests.jsonl (see cost_logger.py).

Usage: cost_report.py [--file FILE] [--today] [--days N] [--short]
       cost_report.py --weekly-fa

  --file FILE  JSONL written by cost_logger (default $KEYPOOL_COST_LOG or
               /var/log/roxira-keypool/requests.jsonl).
  --today      only the current UTC day.
  --days N     only the last N days (UTC).
  --short      at most 12 lines (for the owner's bot).
  --weekly-fa  Persian summary of the last 7 days (plain text, for the owner).

Prints, per model group: calls, success %, total cost (USD), cost per successful call and
p50/p95 latency; the free vs paid share (calls and cost); per feature: calls, answers,
cost, cost per answer and p50/p95 answer latency; per answer: count, mean/p50/p95/max cost
and the top 3 answers by cost; then the top 5 deployment ids by cost.

Answers and features come from the request tags the app sends (llm_gateway.tag(), logged by
cost_logger as answer_id/feature/tenant/plan). Calls without an answer id count as
"untagged" (agents, older log lines). One answer = every call that shares an answer id
(gateway fallbacks and retries included), so cost per answer is what the answer really cost.
Reads only; never prints prompts.
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


def tier_of(rec: dict[str, Any]) -> str:
    """'free' / 'paid' / 'unknown'. The logged deployment tier wins; older lines are inferred.

    Free deployments are rendered with a zero price (render_litellm.py), so a positive cost
    means paid; the provider part of the deployment id ("group:provider:KEY:model") names the
    paid OpenRouter providers (openrouter-paid / openrouter-private).
    """
    tier = rec.get("tier")
    if tier in ("free", "paid"):
        return str(tier)
    dep = str(rec.get("deployment") or "")
    parts = dep.split(":")
    provider = parts[1] if len(parts) >= 4 else ""
    if _cost(rec) > 0 or "paid" in provider or "private" in provider:
        return "paid"
    if provider:
        return "free"
    return "unknown"


def _tag(rec: dict[str, Any], name: str) -> str:
    value = rec.get(name)
    return value if isinstance(value, str) else ""


def answers_of(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """answer id -> cost, summed call latency, call count, feature (first non-empty), success."""
    answers: dict[str, dict[str, Any]] = {}
    for rec in records:
        aid = _tag(rec, "answer_id")
        if not aid:
            continue
        ans = answers.setdefault(aid, {
            "answer_id": aid, "cost": 0.0, "latency": 0.0, "calls": 0, "feature": "",
            "plan": "", "success": False, "paid": False,
        })
        ans["cost"] += _cost(rec)
        ans["latency"] += _latency(rec)
        ans["calls"] += 1
        ans["feature"] = ans["feature"] or _tag(rec, "feature")
        ans["plan"] = ans["plan"] or _tag(rec, "plan")
        ans["success"] = ans["success"] or bool(rec.get("success"))
        ans["paid"] = ans["paid"] or tier_of(rec) == "paid"
    return answers


def _answer_stats(answers: list[dict[str, Any]]) -> dict[str, Any]:
    costs = [a["cost"] for a in answers]
    latencies = [a["latency"] for a in answers]
    n = len(answers)
    return {
        "answers": n,
        "cost_mean": (sum(costs) / n) if n else 0.0,
        "cost_p50": percentile(costs, 0.50),
        "cost_p95": percentile(costs, 0.95),
        "cost_max": max(costs) if costs else 0.0,
        "latency_p50": percentile(latencies, 0.50),
        "latency_p95": percentile(latencies, 0.95),
        "paid_answers": sum(1 for a in answers if a["paid"]),
    }


def aggregate(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Group totals, free/paid share, per-feature and per-answer cost, top 5 deployments."""
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
    tiers: dict[str, dict[str, float]] = {}
    for rec in records:
        t = tiers.setdefault(tier_of(rec), {"calls": 0, "cost": 0.0})
        t["calls"] += 1
        t["cost"] += _cost(rec)

    answers = answers_of(records)
    by_feature: dict[str, list[dict[str, Any]]] = {}
    for rec in records:
        by_feature.setdefault(_tag(rec, "feature") or "untagged", []).append(rec)
    features = []
    for name, recs in by_feature.items():
        ids = {_tag(r, "answer_id") for r in recs if _tag(r, "answer_id")}
        # an answer belongs to the feature of its own calls only (escalations can mix features)
        feat_answers = []
        for aid in ids:
            calls = [r for r in recs if _tag(r, "answer_id") == aid]
            feat_answers.append({
                "cost": sum(_cost(r) for r in calls),
                "latency": sum(_latency(r) for r in calls),
                "paid": any(tier_of(r) == "paid" for r in calls),
            })
        stats = _answer_stats(feat_answers)
        features.append({
            "feature": name,
            "calls": len(recs),
            "total_cost": sum(_cost(r) for r in recs),
            **stats,
        })
    features.sort(key=lambda f: (-f["total_cost"], -f["calls"], f["feature"]))

    answer_list = list(answers.values())
    top_answers = sorted(answer_list, key=lambda a: (-a["cost"], a["answer_id"]))[:3]
    return {
        "calls": len(records),
        "success": sum(1 for r in records if r.get("success")),
        "total_cost": sum(_cost(r) for r in records),
        "groups": groups,
        "tiers": tiers,
        "features": features,
        "answers": {**_answer_stats(answer_list), "top": top_answers},
        "untagged_calls": sum(1 for r in records if not _tag(r, "answer_id")),
        "deployments": deployments,
    }


def _share(part: float, whole: float) -> float:
    return (100.0 * part / whole) if whole else 0.0


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
    tiers = agg.get("tiers") or {}
    if tiers:
        free, paid = tiers.get("free", {}), tiers.get("paid", {})
        lines.append(
            f"free vs paid: calls {_share(free.get('calls', 0), calls):.1f}% free / "
            f"{_share(paid.get('calls', 0), calls):.1f}% paid; "
            f"cost ${paid.get('cost', 0.0):.6f} paid"
            + (f"; {tiers['unknown']['calls']} unknown" if "unknown" in tiers else "")
        )
    ans = agg.get("answers") or {}
    if ans.get("answers"):
        lines.append(
            f"answers: {ans['answers']} ({ans['paid_answers']} touched paid)  "
            f"mean ${ans['cost_mean']:.6f}  p50 ${ans['cost_p50']:.6f}  "
            f"p95 ${ans['cost_p95']:.6f}  max ${ans['cost_max']:.6f}  "
            f"untagged calls {agg.get('untagged_calls', 0)}"
        )
    if agg.get("features"):
        lines.append("per feature:")
        for f in agg["features"]:
            per = f"${f['cost_mean']:.6f}/answer" if f["answers"] else "-"
            lines.append(
                f"  {f['feature']:<20} calls {f['calls']:>4}  answers {f['answers']:>4}  "
                f"${f['total_cost']:.6f}  {per}  "
                f"p50 {f['latency_p50']:.0f}ms  p95 {f['latency_p95']:.0f}ms"
            )
    if ans.get("top"):
        lines.append("top answers by cost:")
        for a in ans["top"]:
            lines.append(
                f"  {a['answer_id'][:16]}  {a['feature'] or '-'}  {a['calls']} calls  "
                f"${a['cost']:.6f}  {a['latency']:.0f}ms"
            )
    if agg["deployments"]:
        lines.append("top deployments by cost:")
        for rank, dep in enumerate(agg["deployments"], start=1):
            lines.append(f"  {rank}. {dep['deployment']}  ${dep['cost']:.6f}")
    if short:
        lines = lines[:SHORT_MAX_LINES]
    return "\n".join(lines)


_FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
WEEKLY_DAYS = 7


def _fa(text: str) -> str:
    return text.translate(_FA_DIGITS)


def format_weekly_fa(agg: dict[str, Any], days: int = WEEKLY_DAYS) -> str:
    """Short Persian weekly summary for the owner (numbers in Persian digits)."""
    calls = agg["calls"]
    period = _fa(str(days))
    if not calls:
        return f"گزارش هفتگی هزینهٔ مدل‌ها ({period} روز اخیر): هیچ فراخوانی ثبت نشده است."
    tiers = agg.get("tiers") or {}
    free_pct = _fa(f"{_share(tiers.get('free', {}).get('calls', 0), calls):.1f}")
    paid_cost = _fa(f"{tiers.get('paid', {}).get('cost', 0.0):.4f}")
    ok_pct = _fa(f"{_share(agg['success'], calls):.1f}")
    total = _fa(f"{agg['total_cost']:.4f}")
    lines = [
        f"📊 گزارش هفتگی هزینهٔ مدل‌ها ({period} روز اخیر)",
        f"فراخوانی‌ها: {_fa(str(calls))} (موفق {ok_pct}٪)",
        f"هزینهٔ کل: {total} دلار",
        f"سهم مدل‌های رایگان: {free_pct}٪ فراخوانی‌ها؛ هزینهٔ مدل‌های پولی: {paid_cost} دلار",
    ]
    ans = agg.get("answers") or {}
    if ans.get("answers"):
        mean = _fa(f"{ans['cost_mean']:.5f}")
        p95 = _fa(f"{ans['cost_p95']:.5f}")
        lines.append(
            f"پاسخ‌ها: {_fa(str(ans['answers']))}؛ میانگین هزینهٔ هر پاسخ {mean} دلار، "
            f"صدک ۹۵: {p95} دلار؛ {_fa(str(ans['paid_answers']))} پاسخ به مدل پولی رسید"
        )
    feats = [f for f in agg.get("features") or [] if f["calls"]][:4]
    if feats:
        lines.append("پرهزینه‌ترین بخش‌ها:")
        for f in feats:
            cost = _fa(f"{f['total_cost']:.4f}")
            latency = _fa(f"{f['latency_p95'] / 1000:.1f}") if f["answers"] else "-"
            lines.append(
                f"• {f['feature']}: {cost} دلار، {_fa(str(f['answers']))} پاسخ، "
                f"زمان پاسخ صدک ۹۵: {latency} ثانیه"
            )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Key-pool cost/latency report from requests.jsonl.")
    ap.add_argument("--file", default=None, help="requests.jsonl (default $KEYPOOL_COST_LOG)")
    ap.add_argument("--today", action="store_true", help="only the current UTC day")
    ap.add_argument("--days", type=int, default=None, help="only the last N days")
    ap.add_argument("--short", action="store_true", help="at most 12 lines")
    ap.add_argument("--weekly-fa", action="store_true", help="Persian 7-day summary for the bot")
    args = ap.parse_args(argv)
    src = Path(args.file or report_path())
    if args.weekly_fa:
        print(format_weekly_fa(aggregate(load_records(src, days=WEEKLY_DAYS))))
        return 0
    records = load_records(src, today=args.today, days=args.days)
    print(format_report(aggregate(records), str(src), short=args.short))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
