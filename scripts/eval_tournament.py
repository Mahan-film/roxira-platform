#!/usr/bin/env python3
"""Run blinded, repeated coding-smoke evaluations for several models."""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from datetime import date
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).parent))
from eval_coding_smoke import load_tasks, run_eval  # noqa: E402

Runner = Callable[[str, str | None, str | None, bool], dict[str, float]]
_TASKS: list[Any] | None = None


def smoke_runner(
    model: str,
    base_url: str | None,
    api_key_env: str | None,
    offline: bool = False,
) -> dict[str, float]:
    """Run the existing smoke corpus once, loading it only on first use."""
    global _TASKS
    if _TASKS is None:
        _TASKS = load_tasks()
    _ = base_url
    key_name = api_key_env or "OPENROUTER_API_KEY"
    summary = run_eval(model, _TASKS, os.environ[key_name], offline=offline)
    return {
        "pass_rate": summary.pass_rate,
        "cost": summary.total_cost_usd,
        "latency": summary.avg_latency_ms / 1000,
    }


def pareto(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return rows not dominated by higher success and lower cost/latency."""
    def metric(row: dict[str, Any], name: str) -> float:
        value = row.get(name)
        return float("inf") if value is None else float(value)

    result = []
    for row in rows:
        dominated = any(
            other is not row
            and other["success_rate"] >= row["success_rate"]
            and metric(other, "cost") <= metric(row, "cost")
            and metric(other, "latency") <= metric(row, "latency")
            and (
                other["success_rate"] > row["success_rate"]
                or metric(other, "cost") < metric(row, "cost")
                or metric(other, "latency") < metric(row, "latency")
            )
            for other in rows
        )
        if not dominated:
            result.append(row)
    return result


def run_tournament(
    models: list[str],
    trials: int,
    runner: Runner = smoke_runner,
    base_url: str | None = None,
    api_key_env: str | None = None,
    offline: bool = False,
    rng: random.Random | None = None,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Run each candidate repeatedly and return blinded aggregate rows."""
    candidates = models[:]
    (rng or random.Random()).shuffle(candidates)
    labels = {chr(65 + index): model for index, model in enumerate(candidates)}
    rows: list[dict[str, Any]] = []
    for label, model in labels.items():
        results: list[dict[str, float]] = []
        errors = 0
        for _trial in range(trials):
            try:
                results.append(runner(model, base_url, api_key_env, offline))
            except Exception:
                errors += 1
                results.append({"pass_rate": 0.0})
        def mean(name: str) -> float | None:
            values = [float(item[name]) for item in results if name in item]
            return sum(values) / len(values) if values else None
        rows.append({"label": label, "success_rate": mean("pass_rate") or 0.0,
                     "cost": mean("cost"), "latency": mean("latency"), "errors": errors})
    return rows, labels


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", required=True)
    parser.add_argument("--trials", type=int, default=1)
    parser.add_argument("--base-url")
    parser.add_argument("--api-key-env")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--out", type=Path, default=Path(f"data/eval/tournament_{date.today()}.json"))
    args = parser.parse_args()
    models = [model.strip() for model in args.models.split(",") if model.strip()]
    if not models or args.trials < 1:
        parser.error("--models and a positive --trials are required")
    rows, labels = run_tournament(models, args.trials, base_url=args.base_url,
                                  api_key_env=args.api_key_env, offline=args.offline)
    selected = {row["label"] for row in pareto(rows)}
    for row in rows:
        print(f"{row['label']} success={row['success_rate']:.3f} cost={row['cost']} latency={row['latency']}" +
              (" *" if row["label"] in selected else ""))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"results": rows, "pareto": sorted(selected), "labels": labels}, indent=2) + "\n")
    print("Label map:")
    for label, model in labels.items():
        print(f"{label}: {model}")


if __name__ == "__main__":
    main()
