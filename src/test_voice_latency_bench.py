"""Unit tests for scripts/voice_latency_bench.py (W7).

scripts/ is outside pytest's `testpaths = ["src"]` and outside the normal
import graph, so the bench module is loaded dynamically by path -- same
pattern as src/test_model_registry.py.

Only the pure statistics helper (percentile/summarize) and the --offline
stubbed end-to-end run are exercised here: no network, no API key, no
edge-tts install, nothing that talks to a live service. The real
`--offline` run is deliberately reused as the CI check, since it is the
same code path an owner would use for a first keyless smoke test.
"""

from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path

import pytest

bench = None  # populated by the fixture before any test runs


@pytest.fixture(scope="session", autouse=True)
def _load_bench_module():
    global bench
    if bench is None:
        module_path = Path(__file__).resolve().parents[1] / "scripts" / "voice_latency_bench.py"
        spec = importlib.util.spec_from_file_location("voice_latency_bench", module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        bench = module


def test_percentile_empty_list_is_zero():
    assert bench.percentile([], 50) == 0.0


def test_percentile_single_value():
    assert bench.percentile([42.0], 95) == 42.0


def test_percentile_p50_matches_median_for_odd_count():
    assert bench.percentile([10, 20, 30], 50) == 20


def test_percentile_p0_and_p100_are_min_and_max():
    values = [5, 1, 9, 3, 7]
    assert bench.percentile(values, 0) == 1
    assert bench.percentile(values, 100) == 9


def test_percentile_is_monotonic_non_decreasing():
    values = [1, 5, 2, 8, 3, 9, 4, 7, 6]
    p50 = bench.percentile(values, 50)
    p95 = bench.percentile(values, 95)
    assert p95 >= p50


def test_summarize_reports_sample_count():
    text = bench.summarize("llm", [10.0, 20.0, 30.0])
    assert "n=3" in text
    assert "llm" in text


def test_summarize_handles_no_samples():
    text = bench.summarize("tts", [])
    assert "no samples" in text


def test_offline_run_bench_produces_samples_for_every_stage():
    module = bench.load_voice_module()
    bench.install_offline_stubs(module)
    results = asyncio.run(bench.run_bench(module, n=5, stream=False))
    assert len(results["llm_ms"]) == 5
    assert len(results["tts_ms"]) == 5
    assert len(results["total_ms"]) == 5
    assert all(v >= 0 for v in results["llm_ms"])


def test_offline_run_bench_streaming_path_also_produces_samples():
    module = bench.load_voice_module()
    bench.install_offline_stubs(module)
    results = asyncio.run(bench.run_bench(module, n=3, stream=True))
    assert len(results["llm_ms"]) == 3
    # the stubbed streaming reply is multiple sentences, so tts should be
    # invoked at least once per turn (one synth call per sentence).
    assert len(results["tts_ms"]) >= 3


def test_main_offline_smoke_exits_zero(capsys):
    exit_code = bench.main(["--n", "2", "--offline"])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "llm" in out
    assert "tts" in out
