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


def test_main_fails_when_no_reviewer_differs_from_executor(crf, tmp_path, capsys):
    reg = _write(tmp_path, ["deepseek/a"], ["deepseek/c", "deepseek/d"])
    assert crf.main(["--registry", str(reg)]) == 1
    assert "FINDING" in capsys.readouterr().out


def test_main_passes_on_different_families(crf, tmp_path):
    reg = _write(tmp_path, ["deepseek/a"], ["anthropic/b", "google/c"])
    assert crf.main(["--registry", str(reg)]) == 0


def test_main_passes_with_one_different_family_among_same_family(crf, tmp_path, capsys):
    # Owner policy: a free non-DeepSeek reviewer first, DeepSeek fallback after it.
    reg = _write(tmp_path, ["deepseek/a"], ["qwen/free:free", "deepseek/c"])
    assert crf.main(["--registry", str(reg)]) == 0
    out = capsys.readouterr().out
    assert "note: reviewer deepseek/c" in out
    assert "FINDING" not in out


def test_main_missing_registry_is_error(crf, tmp_path):
    assert crf.main(["--registry", str(tmp_path / "nope.yaml")]) == 2


@pytest.mark.parametrize(
    "a,b",
    [
        ("gpt-oss-120b", "openai/gpt-oss-120b"),  # served-model names the gateway returns have no slash
        ("openrouter/deepseek/deepseek-v4.1-flash", "deepseek-v4.1-flash"),
        ("@cf/openai/gpt-oss-120b", "openai/gpt-oss-20b"),
        ("gemma-4-31b-it:free", "google/gemini-best"),
        ("nemotron-3-ultra", "nvidia/nemotron-3-super-120b-a12b:free"),
        ("llama-3.3-70b-instruct", "meta-llama/llama-3.3-70b-instruct:free"),
        ("mistral-small-latest", "mistralai/mistral-small-24b-instruct-2501:free"),
    ],
)
def test_bare_and_wrapped_ids_fold_to_the_vendor(crf, a, b):
    assert crf.same_family(a, b)


@pytest.mark.parametrize(
    "a,b",
    [("gpt-oss-120b", "deepseek/deepseek-v4.1-flash"), ("z-ai/glm-5.3", "openrouter/deepseek/deepseek-v4.1-flash"),
     ("keypool/agent-strong-free", "deepseek/deepseek-v4.1-flash"), ("custom-a", "custom-b")],
)
def test_different_vendors_stay_different(crf, a, b):
    assert not crf.same_family(a, b)


def test_known_family_tells_group_names_apart(crf):
    assert crf.known_family("gpt-oss-120b") and crf.known_family("google/gemini-best")
    assert not crf.known_family("keypool/agent-strong-free") and not crf.known_family("agent-free-paid")


@pytest.mark.parametrize(
    "model,fam",
    [("accounts/fireworks/models/gpt-oss-120b", "openai"),  # gpt-oss really is OpenAI's family
     ("accounts/fireworks/models/llama-v3p1-70b-instruct", "meta"),
     ("accounts/fireworks/models/mixtral-8x7b-instruct", "mistral"),
     ("accounts/fireworks/models/kimi-k2-instruct", "moonshot")],
)
def test_fireworks_paths_fold_to_the_model_vendor(crf, model, fam):
    assert crf.family(model) == fam


def test_unknown_fireworks_model_is_not_filed_under_the_host_path(crf):
    assert crf.family("accounts/fireworks/models/foo-1") == "foo-1"
