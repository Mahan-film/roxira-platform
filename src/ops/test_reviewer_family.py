"""Offline tests for scripts/dev/check_reviewer_family.py."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def crf():
    path = ROOT / "scripts/dev/check_reviewer_family.py"
    spec = importlib.util.spec_from_file_location("check_reviewer_family_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    "a,b",
    [
        ("deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4-flash"),
        ("qwen/qwen3-coder", "alibaba/qwen-max"),
        ("z-ai/glm-5.3", "glm/glm-4"),
        ("google/gemini-3.8-flash", "gemini/gemini-pro"),
        ("anthropic/claude-sonnet-5", "claude/sonnet"),
        ("meta-llama/llama-4", "llama/llama-4"),
        ("xiaomi/mimo-v2", "mimo/mimo-v2"),
        ("openai/gpt-5", "openai/gpt-5-mini"),
        ("mistralai/mistral-large", "mistral/small"),
    ],
)
def test_same_family(crf, a, b):
    assert crf.same_family(a, b)


@pytest.mark.parametrize(
    "a,b",
    [
        ("deepseek/deepseek-v4-flash", "anthropic/claude-sonnet-5"),
        ("qwen/qwen3-coder", "google/gemini-3.8-flash"),
        ("openai/gpt-5", "mistralai/mistral-large"),
    ],
)
def test_different_family(crf, a, b):
    assert not crf.same_family(a, b)


def _write(tmp_path, executor, reviewer):
    def block(ids):
        return "".join(f"      - id: {i}\n" for i in ids)

    parts = ["roles:\n  executor:\n    models:\n", block(executor)]
    parts += ["  reviewer:\n    models:\n", block(reviewer)]
    p = tmp_path / "models.yaml"
    p.write_text("".join(parts), encoding="utf-8")
    return p


def test_main_fails_on_shared_family(crf, tmp_path, capsys):
    reg = _write(tmp_path, ["deepseek/a"], ["anthropic/b", "deepseek/c"])
    assert crf.main(["--registry", str(reg)]) == 1
    assert "FINDING" in capsys.readouterr().out


def test_main_passes_on_different_families(crf, tmp_path):
    reg = _write(tmp_path, ["deepseek/a"], ["anthropic/b", "google/c"])
    assert crf.main(["--registry", str(reg)]) == 0


def test_main_missing_registry_is_error(crf, tmp_path):
    assert crf.main(["--registry", str(tmp_path / "nope.yaml")]) == 2
