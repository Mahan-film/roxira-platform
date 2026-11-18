"""Tests for the Smart Judge replay benchmark (per-stage p50/p95)."""
from __future__ import annotations

from output_apps.generated_modules.smartjudge.eval.replay_benchmark import (
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
    assert "total_ms" in format_report(summary)


def test_replay_benchmark_offline_cli(capsys):
    rc = main(["--offline", "--runs", "1", "--json"])
    assert rc == 0
    out = capsys.readouterr().out
    assert '"embed_ms"' in out
    assert '"p50"' in out
    assert '"p95"' in out
