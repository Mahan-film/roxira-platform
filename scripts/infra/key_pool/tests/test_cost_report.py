"""Offline tests for cost_report: aggregation, UTC windows, short output."""
from __future__ import annotations

import json
import pathlib
import sys
from datetime import datetime, timezone

import pytest

HERE = pathlib.Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))

import cost_report

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)


def _ts(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _rec(group, dep, success, cost, latency, ts):
    return {
        "ts": ts, "model_group": group, "deployment": dep, "provider": "groq",
        "prompt_tokens": 1, "completion_tokens": 1, "response_cost": cost,
        "latency_ms": latency, "success": success, "error": "" if success else "RuntimeError",
    }


def _fixture():
    return [
        _rec("agent-strong-free", "d1", True, 0.001, 100, _ts(NOW)),
        _rec("agent-strong-free", "d1", True, 0.002, 300, _ts(NOW)),
        _rec("agent-strong-free", "d2", False, 0.0, 400, _ts(NOW)),
        _rec("product-free", "d3", True, 0.0005, 50, _ts(NOW)),
        _rec("product-free", "d3", True, 0.0005, 70, _ts(NOW)),
    ]


def test_aggregate_groups_and_top_deployments():
    agg = cost_report.aggregate(_fixture())
    assert agg["calls"] == 5 and agg["success"] == 4
    assert agg["total_cost"] == pytest.approx(0.004)

    groups = {g["group"]: g for g in agg["groups"]}
    strong = groups["agent-strong-free"]
    assert strong["calls"] == 3 and strong["success"] == 2
    assert strong["success_pct"] == pytest.approx(66.666, rel=1e-3)
    assert strong["total_cost"] == pytest.approx(0.003)
    assert strong["cost_per_success"] == pytest.approx(0.0015)
    assert strong["p50"] == pytest.approx(300)
    assert strong["p95"] == pytest.approx(390)

    product = groups["product-free"]
    assert product["success_pct"] == pytest.approx(100.0)
    assert product["p50"] == pytest.approx(60)
    assert product["p95"] == pytest.approx(69)

    assert agg["deployments"][0]["deployment"] == "d1"
    assert agg["deployments"][0]["cost"] == pytest.approx(0.003)
    assert [d["deployment"] for d in agg["deployments"]] == ["d1", "d3", "d2"]


def test_load_records_filters_and_skips_bad_lines(tmp_path):
    path = tmp_path / "requests.jsonl"
    records = _fixture() + [_rec("old", "d9", True, 0.5, 10, "2026-09-01T00:00:00Z")]
    path.write_text("\n".join(json.dumps(r) for r in records) + "\nnot json\n", encoding="utf-8")

    assert len(cost_report.load_records(path, now=NOW)) == 6
    assert len(cost_report.load_records(path, today=True, now=NOW)) == 5
    assert len(cost_report.load_records(path, days=1, now=NOW)) == 5
    assert len(cost_report.load_records(path, days=60, now=NOW)) == 6


def test_short_report_caps_lines(tmp_path, capsys):
    path = tmp_path / "requests.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in _fixture()) + "\n", encoding="utf-8")

    text = cost_report.format_report(cost_report.aggregate(_fixture()), "x", short=True)
    assert len(text.splitlines()) <= 12
    assert "top deployments by cost:" in text

    assert cost_report.main(["--file", str(path), "--short"]) == 0
    out = capsys.readouterr().out
    assert len(out.splitlines()) <= 12
