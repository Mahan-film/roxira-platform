from __future__ import annotations

import random

import pytest

from scripts import eval_tournament


def test_pareto_excludes_dominated_row() -> None:
    rows = [
        {"label": "A", "success_rate": 1.0, "cost": 2.0, "latency": 2.0},
        {"label": "B", "success_rate": 1.0, "cost": 1.0, "latency": 2.0},
        {"label": "C", "success_rate": 0.5, "cost": 1.0, "latency": 1.0},
    ]
    assert [row["label"] for row in eval_tournament.pareto(rows)] == ["B", "C"]


def test_tournament_blinds_order_and_keeps_errors() -> None:
    calls: list[str] = []

    def runner(model: str, _url: str | None, _env: str | None, _offline: bool) -> dict[str, float]:
        calls.append(model)
        if model == "two":
            raise RuntimeError("failed")
        return {"pass_rate": 1.0, "cost": 1.0, "latency": 1.0}

    rows, labels = eval_tournament.run_tournament(
        ["one", "two", "three"], 1, runner=runner, rng=random.Random(3)
    )
    assert [row["label"] for row in rows] == ["A", "B", "C"]
    assert list(labels.values()) != ["one", "two", "three"]
    assert calls == list(labels.values())
    failed = next(row for row in rows if labels[row["label"]] == "two")
    assert failed["success_rate"] == 0.0
    assert failed["errors"] == 1


def test_smoke_runner_supports_offline_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TOURNAMENT_TEST_KEY", "unused")
    eval_tournament._TASKS = None
    result = eval_tournament.smoke_runner("test-model", None, "TOURNAMENT_TEST_KEY", offline=True)
    assert set(result) == {"pass_rate", "cost", "latency"}
