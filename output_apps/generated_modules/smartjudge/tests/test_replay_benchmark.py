"""Tests for the Smart Judge replay benchmark and Rust Hot-Path Gate (T308 / R33)."""
from __future__ import annotations

from output_apps.generated_modules.smartjudge.eval.replay_benchmark import (
    RUST_GATE_PROTOTYPE_SPEEDUP_THRESHOLD,
    RUST_GATE_STAGE_SHARE_THRESHOLD_PCT,
    evaluate_rust_gate,
    format_report,
    main,
    percentile,
    summarize_stages,
)
from output_apps.generated_modules.smartjudge.retrieval_contract import RetrievalTimings


def test_percentile_and_summarize_stages():
    assert percentile([], 50) == 0.0
    assert percentile([10.0, 20.0, 30.0, 40.0, 100.0], 50) == 30.0
    assert percentile([10.0, 20.0, 30.0, 40.0, 100.0], 95) == 100.0

    summary = summarize_stages([
        RetrievalTimings(embed_ms=2.0, qdrant_ms=10.0, sql_ms=5.0, total_ms=12.0),
        RetrievalTimings(embed_ms=4.0, qdrant_ms=20.0, sql_ms=8.0, total_ms=25.0),
    ])
    assert summary["embed_ms"]["p50"] == 2.0
    assert summary["qdrant_ms"]["p95"] == 20.0
    assert summary["qdrant_ms"]["p95_share_pct"] == 80.0
    assert "total_ms" in format_report(summary)
    assert "Rust Hot-Path Gate" in format_report(summary)


def test_evaluate_rust_gate_prohibited_when_share_below_threshold():
    # All stages under 30% of total p95 (100.0ms)
    summary = {
        "embed_ms": {"p50": 5.0, "p95": 10.0, "p95_share_pct": 10.0},
        "qdrant_ms": {"p50": 15.0, "p95": 20.0, "p95_share_pct": 20.0},
        "sql_ms": {"p50": 10.0, "p95": 15.0, "p95_share_pct": 15.0},
        "total_ms": {"p50": 80.0, "p95": 100.0, "p95_share_pct": 100.0},
    }
    gate = evaluate_rust_gate(summary)
    assert gate["verdict"] == "REWRITE_PROHIBITED"
    assert len(gate["eligible_stages"]) == 0
    assert "No stage exceeds 30.0%" in gate["reason"]


def test_evaluate_rust_gate_prohibited_when_speedup_insufficient():
    # Stage exceeds 30% but prototype speedup is only 1.5x (needs > 2.0x)
    summary = {
        "embed_ms": {"p50": 30.0, "p95": 40.0, "p95_share_pct": 40.0},
        "total_ms": {"p50": 90.0, "p95": 100.0, "p95_share_pct": 100.0},
    }
    gate = evaluate_rust_gate(summary, prototype_speedups={"embed_ms": 1.5})
    assert gate["verdict"] == "REWRITE_PROHIBITED"
    assert len(gate["eligible_stages"]) == 0
    assert "proven prototype speedup > 2.0x was not demonstrated" in gate["reason"]


def test_evaluate_rust_gate_permitted_when_criteria_met():
    # Stage exceeds 30% and prototype achieves 2.5x speedup (> 2.0x)
    summary = {
        "embed_ms": {"p50": 35.0, "p95": 45.0, "p95_share_pct": 45.0},
        "sql_ms": {"p50": 10.0, "p95": 15.0, "p95_share_pct": 15.0},
        "total_ms": {"p50": 90.0, "p95": 100.0, "p95_share_pct": 100.0},
    }
    gate = evaluate_rust_gate(summary, prototype_speedups={"embed_ms": 2.5})
    assert gate["verdict"] == "REWRITE_PERMITTED"
    assert gate["eligible_stages"] == ["embed_ms"]
    assert "meet all gate criteria" in gate["reason"]


def test_replay_benchmark_offline_cli(capsys):
    rc = main(["--offline", "--runs", "1", "--json"])
    assert rc == 0
    out = capsys.readouterr().out
    assert '"embed_ms"' in out
    assert '"p50"' in out
    assert '"p95"' in out
    assert '"rust_gate"' in out
    assert '"REWRITE_PROHIBITED"' in out


def test_replay_benchmark_offline_cli_gate_fails_when_prohibited(capsys):
    # Without prototype speedup > 2.0x, --check-gate fails with exit code 1
    rc = main(["--offline", "--runs", "1", "--check-gate"])
    assert rc == 1
    out = capsys.readouterr().out
    assert "REWRITE_PROHIBITED" in out


def test_replay_benchmark_offline_cli_gate_passes_when_speedup_demonstrated(capsys):
    # With proven prototype speedup > 2.0x on a stage exceeding 30% p95, --check-gate passes with exit code 0
    rc = main(["--offline", "--runs", "1", "--check-gate", "--prototype-speedup", "qdrant_ms=2.5"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "REWRITE_PERMITTED" in out
