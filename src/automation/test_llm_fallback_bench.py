"""Offline unit tests for the local LLM fallback benchmark (issue #337).

The benchmark script is loaded by path inside a fixture (not imported at module
load), so collecting this test has no side effects and needs no server, network,
or API key. The HTTP transport is injected as a plain callable.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "llm_fallback_bench.py"


@pytest.fixture(scope="module")
def bench() -> ModuleType:
    spec = importlib.util.spec_from_file_location("llm_fallback_bench_under_test", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _prompt(pid: str, check: dict | None) -> dict:
    prompt = {
        "id": pid,
        "lang": "x",
        "task": "t",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 16,
    }
    if check is not None:
        prompt["check"] = check
    return prompt


def test_run_bench_summarizes_stats(bench: ModuleType) -> None:
    def fake_post(url, payload, headers, timeout):
        assert url.endswith("/chat/completions")
        return {
            "choices": [{"message": {"content": "دادگاه تأیید status"}}],
            "usage": {"completion_tokens": 4},
        }

    prompts = [
        _prompt("a", {"kind": "contains", "any": ["تأیید"]}),
        _prompt("b", {"kind": "contains", "any": ["status"]}),
    ]
    # Two clock reads per prompt: 0.0->0.5 and 1.0->2.0.
    ticks = iter([0.0, 0.5, 1.0, 2.0])
    results = bench.run_bench(
        prompts,
        post=fake_post,
        base_url="http://127.0.0.1:8080/v1",
        model="test-model",
        clock=lambda: next(ticks),
    )
    summary = bench.summarize(results)

    assert summary["n"] == 2
    assert summary["failed"] == 0
    assert summary["checked"] == 2
    assert summary["passed"] == 2
    assert summary["pass_rate"] == pytest.approx(1.0)
    assert summary["mean_latency_ms"] == pytest.approx(750.0)
    assert summary["p50_latency_ms"] == pytest.approx(750.0)
    assert summary["p95_latency_ms"] == pytest.approx(975.0)
    assert summary["mean_tokens_per_sec"] == pytest.approx(6.0)
    assert results[0]["completion_tokens"] == 4
    assert results[0]["tokens_per_sec"] == pytest.approx(8.0)


def test_failed_request_counts_as_failure(bench: ModuleType) -> None:
    def failing_post(url, payload, headers, timeout):
        raise RuntimeError("connection refused")

    prompts = [
        _prompt("a", {"kind": "contains", "any": ["x"]}),
        _prompt("b", {"kind": "contains", "any": ["y"]}),
    ]
    results = bench.run_bench(
        prompts,
        post=failing_post,
        base_url="http://127.0.0.1:8080/v1",
        model="test-model",
        clock=lambda: 0.0,
    )
    summary = bench.summarize(results)

    assert all(row["ok"] is False for row in results)
    assert all(row["error"] == "connection refused" for row in results)
    assert all(row["check_expected"] is True for row in results)
    assert all(row["check_passed"] is None for row in results)
    assert summary["failed"] == 2
    assert summary["checked"] == 2
    assert summary["passed"] == 0
    assert summary["pass_rate"] == pytest.approx(0.0)
    assert summary["mean_tokens_per_sec"] is None


def test_missing_check_is_not_counted(bench: ModuleType) -> None:
    def fake_post(url, payload, headers, timeout):
        return {
            "choices": [{"message": {"content": "anything"}}],
            "usage": {"completion_tokens": 2},
        }

    results = bench.run_bench(
        [_prompt("a", None)],
        post=fake_post,
        base_url="http://127.0.0.1:8080/v1",
        model="test-model",
        clock=lambda: 0.0,
    )
    summary = bench.summarize(results)

    assert results[0]["check_expected"] is False
    assert results[0]["check_passed"] is None
    assert summary["checked"] == 0
    assert summary["pass_rate"] is None


def test_label_check_requires_the_single_expected_label(bench: ModuleType) -> None:
    check = {
        "kind": "label",
        "expected": "استعلام",
        "labels": ["شکایت", "استعلام", "سایر"],
    }
    assert bench.evaluate_check(check, "استعلام") is True
    assert bench.evaluate_check(check, "شکایت") is False
    assert bench.evaluate_check(check, "شکایت و استعلام") is False
