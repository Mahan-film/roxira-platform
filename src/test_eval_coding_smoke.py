"""Unit tests for scripts/eval_coding_smoke.py (W12 follow-up).

scripts/eval_coding_smoke.py lives outside pytest's `testpaths = ["src"]`, so
it is loaded dynamically in a fixture -- same pattern as src/test_check_models.py
and src/factory/test_cost_ledger.py.

Fully offline: covers code extraction, the pass-rate/cost gate, and cost
math. No network call, no OPENROUTER_API_KEY/OPENROUTER_AGENT_KEY read. The
harness's own --offline mode (canned reference-solution responses, exercised
end to end including the pytest-in-a-subprocess grading path) is covered
separately below, still with no network and no key required.
"""

from __future__ import annotations

import importlib.util
import sys
import textwrap
from pathlib import Path

import pytest

eval_coding_smoke = None  # populated by _load_eval_coding_smoke() before any test runs


@pytest.fixture(scope="session", autouse=True)
def _load_eval_coding_smoke():
    global eval_coding_smoke
    if eval_coding_smoke is None:
        module_path = Path(__file__).resolve().parents[1] / "scripts" / "eval_coding_smoke.py"
        spec = importlib.util.spec_from_file_location("eval_coding_smoke", module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["eval_coding_smoke"] = module
        spec.loader.exec_module(module)
        eval_coding_smoke = module


# ---------------------------------------------------------------------------
# Code extraction
# ---------------------------------------------------------------------------


def test_extract_code_simple_fence():
    text = "Here is the code:\n```python\ndef f():\n    return 1\n```\n"
    code = eval_coding_smoke.extract_code(text)
    assert code == "def f():\n    return 1\n"


def test_extract_code_fence_without_language_tag():
    text = "```\nx = 1\n```"
    code = eval_coding_smoke.extract_code(text)
    assert code == "x = 1\n"


def test_extract_code_no_fence_returns_none():
    assert eval_coding_smoke.extract_code("just some prose, no code block") is None


def test_extract_code_takes_first_block_only():
    text = "```python\nfirst = 1\n```\nsome text\n```python\nsecond = 2\n```"
    code = eval_coding_smoke.extract_code(text)
    assert "first" in code
    assert "second" not in code


def test_extract_code_strips_trailing_blank_lines():
    text = "```python\n\n\ndef f():\n    pass\n\n\n```"
    code = eval_coding_smoke.extract_code(text)
    assert code.strip() == "def f():\n    pass"


# ---------------------------------------------------------------------------
# Gate logic
# ---------------------------------------------------------------------------


def test_gate_fails_on_lower_pass_rate():
    result = eval_coding_smoke.gate_passes(0.5, 0.8, candidate_cost_usd=0.01, primary_cost_usd=0.10)
    assert not result


def test_gate_passes_on_strictly_higher_pass_rate_regardless_of_cost():
    assert eval_coding_smoke.gate_passes(0.9, 0.7, candidate_cost_usd=10.0, primary_cost_usd=0.01)


def test_gate_equal_pass_rate_within_cost_multiplier():
    assert eval_coding_smoke.gate_passes(0.8, 0.8, candidate_cost_usd=0.14, primary_cost_usd=0.10)


def test_gate_equal_pass_rate_exceeds_cost_multiplier():
    result = eval_coding_smoke.gate_passes(0.8, 0.8, candidate_cost_usd=0.16, primary_cost_usd=0.10)
    assert not result


def test_gate_equal_pass_rate_exactly_at_multiplier_boundary():
    assert eval_coding_smoke.gate_passes(0.8, 0.8, candidate_cost_usd=0.15, primary_cost_usd=0.10)


def test_gate_zero_primary_cost_requires_zero_candidate_cost():
    assert eval_coding_smoke.gate_passes(0.8, 0.8, candidate_cost_usd=0.0, primary_cost_usd=0.0)
    result = eval_coding_smoke.gate_passes(0.8, 0.8, candidate_cost_usd=0.01, primary_cost_usd=0.0)
    assert not result


def test_gate_zero_primary_pass_rate_candidate_equal_zero_needs_cost_check():
    assert eval_coding_smoke.gate_passes(0.0, 0.0, candidate_cost_usd=0.0, primary_cost_usd=0.0)


# ---------------------------------------------------------------------------
# Cost math
# ---------------------------------------------------------------------------


def test_estimate_cost_uses_usage_cost_when_present():
    usage = {"cost_usd": 0.1234, "prompt_tokens": 1000, "completion_tokens": 500}
    assert eval_coding_smoke.estimate_cost_usd(usage, "some/model") == 0.1234


def test_estimate_cost_falls_back_to_registry_price(tmp_path, monkeypatch):
    registry_path = tmp_path / "models.yaml"
    registry_path.write_text(
        textwrap.dedent(
            """\
            schema_version: 1
            roles:
              cheap:
                description: test
                data_policy: standard
                models:
                  - id: vendor/priced-model
                    price_per_1m: { in: 1.0, out: 2.0 }
            """
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(eval_coding_smoke.model_registry, "REGISTRY_PATH", registry_path)
    eval_coding_smoke.model_registry.load.cache_clear()

    usage = {"prompt_tokens": 1_000_000, "completion_tokens": 500_000}
    cost = eval_coding_smoke.estimate_cost_usd(usage, "vendor/priced-model")
    assert cost == pytest.approx(1.0 * 1.0 + 0.5 * 2.0)

    eval_coding_smoke.model_registry.load.cache_clear()


def test_estimate_cost_unknown_model_no_usage_cost_is_zero(tmp_path, monkeypatch):
    registry_path = tmp_path / "models.yaml"
    registry_path.write_text(
        "schema_version: 1\nroles:\n  cheap:\n    description: t\n"
        "    data_policy: standard\n    models: []\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(eval_coding_smoke.model_registry, "REGISTRY_PATH", registry_path)
    eval_coding_smoke.model_registry.load.cache_clear()

    usage = {"prompt_tokens": 1000, "completion_tokens": 500}
    assert eval_coding_smoke.estimate_cost_usd(usage, "vendor/unknown-model") == 0.0

    eval_coding_smoke.model_registry.load.cache_clear()


# ---------------------------------------------------------------------------
# Task loading (real data/eval/coding_smoke fixtures, still fully offline)
# ---------------------------------------------------------------------------


def test_load_tasks_reads_manifest_and_files():
    tasks = eval_coding_smoke.load_tasks()
    assert 6 <= len(tasks) <= 8
    ids = [t.id for t in tasks]
    assert len(ids) == len(set(ids)), "task ids must be unique"
    for task in tasks:
        assert task.prompt.strip()
        assert task.starter_code.strip()
        assert task.checks_code.strip()
        assert task.reference_solution.strip()
        assert task.timeout_s > 0


def test_reference_solutions_pass_their_own_checks():
    """Every reference_solution.py must actually pass its own checks.py --
    guards against a hidden test that's out of sync with the reference
    implementation. Runs in the same restricted subprocess the real harness
    uses for grading."""
    tasks = eval_coding_smoke.load_tasks()
    for task in tasks:
        result = eval_coding_smoke.run_checks(task.reference_solution, task)
        msg = f"{task.id}: reference_solution.py fails its own checks:\n{result.detail}"
        assert result.passed, msg


# ---------------------------------------------------------------------------
# End-to-end offline run (no network, no key)
# ---------------------------------------------------------------------------


def test_offline_run_eval_passes_every_task():
    tasks = eval_coding_smoke.load_tasks()
    summary = eval_coding_smoke.run_eval("any/model-id", tasks, api_key=None, offline=True)
    assert summary.n_tasks == len(tasks)
    assert summary.pass_rate == 1.0
    assert summary.total_cost_usd == 0.0


def test_offline_main_single_model(capsys):
    code = eval_coding_smoke.main(["--model", "any/model-id", "--offline", "--json"])
    assert code == 0
    captured = capsys.readouterr()
    payload = eval_coding_smoke.json.loads(captured.out)
    assert payload[0]["pass_rate"] == 1.0


def test_offline_main_requires_key_without_offline(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_AGENT_KEY", raising=False)
    code = eval_coding_smoke.main(["--model", "any/model-id"])
    assert code == 2


def test_offline_compare_requires_role_and_candidate():
    code = eval_coding_smoke.main(["--compare", "--offline"])
    assert code == 2
