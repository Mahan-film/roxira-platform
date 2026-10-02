"""Pure bake-off scoring: Pareto ranking, eligibility and Persian reporting.

The owner's bake-off lab builds a small tracer bullet of each candidate stack,
runs the same acceptance suite, and scores the results. This module is the
deterministic, side-effect-free core (no I/O, no model calls): it turns raw
trials into summary metrics, finds the non-dominated frontier, applies the
incumbent promotion rule and renders a compact Persian comparison.

Design: docs/ops/BAKEOFF.md, docs/research/nextgen/B_selfimprovement_bakeoff_radar.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import Any


@dataclass(frozen=True)
class Summary:
    """Aggregated result for one candidate; `trials` carries the raw runs."""

    name: str
    success_rate: float
    median_cost: float
    p90_cost: float
    median_seconds: float
    violations_total: int

    @property
    def eligible(self) -> bool:
        """A candidate with any policy violation is never eligible."""
        return self.violations_total == 0


def _percentile(values: list[float], fraction: float) -> float:
    """Linear-interpolation percentile; empty input yields 0.0."""
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return float(ordered[lower] * (1 - weight) + ordered[upper] * weight)


def summarize(candidate: dict[str, Any]) -> Summary:
    """Aggregate one `{name, trials: [{passed, cost_usd, seconds, policy_violations}]}`."""
    trials = candidate.get("trials") or []
    costs = [float(trial.get("cost_usd") or 0) for trial in trials]
    seconds = [float(trial.get("seconds") or 0) for trial in trials]
    passed = sum(1 for trial in trials if trial.get("passed"))
    violations = sum(int(trial.get("policy_violations") or 0) for trial in trials)
    return Summary(
        name=str(candidate.get("name", "")),
        success_rate=(passed / len(trials)) if trials else 0.0,
        median_cost=float(median(costs)) if costs else 0.0,
        p90_cost=_percentile(costs, 0.9),
        median_seconds=float(median(seconds)) if seconds else 0.0,
        violations_total=violations,
    )


def pareto(summaries: list[Summary]) -> list[Summary]:
    """Return eligible candidates not dominated on success up, cost/time down."""
    eligible = [item for item in summaries if item.eligible]
    frontier: list[Summary] = []
    for item in eligible:
        dominated = any(
            other is not item
            and other.success_rate >= item.success_rate
            and other.p90_cost <= item.p90_cost
            and other.median_seconds <= item.median_seconds
            and (
                other.success_rate > item.success_rate
                or other.p90_cost < item.p90_cost
                or other.median_seconds < item.median_seconds
            )
            for other in eligible
        )
        if not dominated:
            frontier.append(item)
    return frontier


def _best(candidates: list[Summary]) -> Summary:
    return max(candidates, key=lambda item: (item.success_rate, -item.p90_cost))


def choose(
    summaries: list[Summary], incumbent: str | None = None
) -> tuple[Summary | None, list[str]]:
    """Pick a winner and explain it in Persian.

    A challenger replaces the incumbent only on strictly higher success_rate
    and p90_cost no worse than the incumbent's. Without an incumbent, the best
    eligible candidate by success_rate then cost wins.
    """
    reasons: list[str] = []
    rejected = [item for item in summaries if not item.eligible]
    if rejected:
        names = "، ".join(item.name for item in rejected)
        reasons.append(f"حذف به دلیل نقض سیاست: {names}")

    eligible = [item for item in summaries if item.eligible]
    if not eligible:
        reasons.append("هیچ نامزد واجد شرایطی وجود ندارد.")
        return None, reasons

    if not incumbent:
        winner = _best(eligible)
        reasons.append(
            f"بهترین نامزد واجد شرایط «{winner.name}» است "
            f"(نرخ موفقیت {winner.success_rate:.0%}، هزینه p90 ${winner.p90_cost:.4f})."
        )
        return winner, reasons

    current = next((item for item in eligible if item.name == incumbent), None)
    if current is None:
        winner = _best(eligible)
        reasons.append(
            f"نامزد مرجع «{incumbent}» واجد شرایط نبود؛ بهترین نامزد واجد شرایط «{winner.name}» است."
        )
        return winner, reasons

    challengers = [
        item
        for item in eligible
        if item.name != current.name
        and item.success_rate > current.success_rate
        and item.p90_cost <= current.p90_cost
    ]
    if not challengers:
        reasons.append(
            f"«{current.name}» جایگاه خود را حفظ کرد: هیچ رقیبی همزمان نرخ موفقیت بالاتر "
            "و هزینه p90 کمتر یا مساوی نداشت."
        )
        return current, reasons

    winner = max(challengers, key=lambda item: (item.success_rate, -item.p90_cost))
    reasons.append(
        f"«{winner.name}» با نرخ موفقیت {winner.success_rate:.0%} و هزینه p90 "
        f"${winner.p90_cost:.4f} جای «{current.name}» را گرفت."
    )
    return winner, reasons


def _display(name: str, labels: dict[str, str] | None) -> str:
    return (labels or {}).get(name, name)


def render_report_fa(
    summaries: list[Summary],
    winner: Summary | None,
    reasons: list[str],
    labels: dict[str, str] | None = None,
) -> str:
    """Render a compact Persian comparison table, winner line and reasons.

    `labels` optionally maps a candidate name to a blinded display label.
    """
    lines = [
        "## مقایسه نامزدها",
        "",
        "| نامزد | نرخ موفقیت | هزینه p90 | زمان (ثانیه) | نقض سیاست |",
        "| --- | --- | --- | --- | --- |",
    ]
    for item in summaries:
        lines.append(
            f"| {_display(item.name, labels)} | {item.success_rate:.0%} | "
            f"${item.p90_cost:.4f} | {item.median_seconds:.1f} | {item.violations_total} |"
        )
    lines.append("")
    lines.append(
        f"برنده: {_display(winner.name, labels)}" if winner is not None else "برنده: ندارد"
    )
    for reason in reasons:
        lines.append(f"- {reason}")
    return "\n".join(lines)
