"""Offline unit tests for the Persian STT WER/latency benchmark (issue #316).

The benchmark script is loaded by path inside a fixture (not imported at module
load), so collecting this test has no side effects and needs no models,
network, or API keys. Engines are injected as plain callables.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "stt_bench.py"


@pytest.fixture(scope="module")
def bench() -> ModuleType:
    spec = importlib.util.spec_from_file_location("stt_bench_under_test", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_normalization_makes_variants_equal(bench: ModuleType) -> None:
    # Arabic yeh/kaf (U+064A/U+0643) and Persian digits vs their Persian/ASCII
    # equivalents must not count as errors.
    arabic = "\u0639\u0644\u064a \u0643\u064a\u0633\u062a \u06f1\u06f2\u06f3"
    persian = "\u0639\u0644\u06cc \u06a9\u06cc\u0633\u062a 123"
    assert bench.wer(arabic, persian) == 0.0
    # A ZWNJ inside a compound word is presentation-only.
    assert bench.wer("\u0645\u06cc\u200c\u0631\u0648\u0645", "\u0645\u06cc\u0631\u0648\u0645") == 0.0


def test_wer_counts_single_substitution(bench: ModuleType) -> None:
    assert bench.wer("الف ب پ ت", "الف ب پ ث") == pytest.approx(0.25)


def test_wer_handles_empty_reference(bench: ModuleType) -> None:
    assert bench.wer("", "") == 0.0
    assert bench.wer("", "سلام") == 1.0


def test_percentile_interpolates(bench: ModuleType) -> None:
    values = [10.0, 20.0, 30.0, 40.0]
    assert bench.percentile(values, 50) == pytest.approx(25.0)
    assert bench.percentile(values, 95) == pytest.approx(38.5)
    assert bench.percentile([], 50) == 0.0


def test_run_bench_summarizes_wer_and_latency(bench: ModuleType) -> None:
    samples = [
        {"name": "a", "audio": "a.wav", "reference": "الف ب"},
        {"name": "b", "audio": "b.wav", "reference": "ج د"},
    ]

    def perfect(path: str) -> str:
        return "الف ب" if path == "a.wav" else "ج د"

    def wrong(path: str) -> str:
        # One deletion out of two reference words, on each sample.
        return "الف" if path == "a.wav" else "ج"

    results = bench.run_bench(samples, {"perfect": perfect, "wrong": wrong})

    assert results["perfect"]["mean_wer"] == 0.0
    assert results["wrong"]["mean_wer"] == pytest.approx(0.5)
    for data in results.values():
        assert data["n"] == 2
        assert data["p50_latency_ms"] >= 0.0
        assert data["p95_latency_ms"] >= data["p50_latency_ms"]
        assert len(data["samples"]) == 2


def test_resolve_engines_skips_unavailable_and_unknown(bench: ModuleType) -> None:
    def available() -> str:
        return "ok"

    def unavailable() -> str:
        raise bench.EngineUnavailable("missing key")

    engines = bench.resolve_engines(
        ["available", "unavailable", "does-not-exist"],
        builders={"available": available, "unavailable": unavailable},
    )
    assert engines == {"available": "ok"}
