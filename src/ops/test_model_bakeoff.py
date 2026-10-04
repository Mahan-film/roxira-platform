"""Offline tests for scripts/dev/model_bakeoff.py (fake HTTP, no network)."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
mb = None


@pytest.fixture(autouse=True, scope="module")
def _load_model_bakeoff():
    """Load scripts/dev/model_bakeoff.py inside a fixture (no import-time code here)."""
    global mb
    path = ROOT / "scripts/dev/model_bakeoff.py"
    spec = importlib.util.spec_from_file_location("model_bakeoff", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["model_bakeoff"] = module
    spec.loader.exec_module(module)
    module._SLEEP = 0
    mb = module
    yield

KEY = "sk-or-SECRETVALUE123"


def fake_post(url, headers, body, timeout=0):
    return {
        "choices": [{"message": {"content": "طبق قانون آیین دادرسی مدنی ماده 336"}}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50},
    }


def args(tmp_path, *extra):
    base = ["--limit", "3", "--md-out", str(tmp_path / "b.md")]
    return [*base, "--state-dir", str(tmp_path / "st"), *extra]


def test_run_outputs_and_no_key(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("OPENROUTER_API_KEY", KEY)
    assert mb.main(args(tmp_path, "--models", "openai/gpt-oss-120b"), post=fake_post) == 0
    out = capsys.readouterr()
    blob = out.out + out.err + (tmp_path / "b.md").read_text()
    blob += next((tmp_path / "st").glob("*.json")).read_text()
    assert KEY not in blob
    assert "| openai/gpt-oss-120b |" in blob


def test_refuses_non_eval_path(tmp_path, capsys):
    other = tmp_path / "x.jsonl"
    other.write_text("{}")
    assert mb.main(args(tmp_path, "--dry-run", "--eval-set", str(other))) == 2
    assert "refused" in capsys.readouterr().err


def test_budget_stop(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", KEY)
    calls = []

    def post(*a, **k):
        calls.append(1)
        return fake_post(*a)

    argv = args(tmp_path, "--max-usd", "0.0000001", "--models", "google/gemini-3.8-flash")
    assert mb.main(argv, post=post) == 0
    assert not calls
    rep = json.loads(next((tmp_path / "st").glob("*.json")).read_text())
    assert rep["budget_stopped"] is True


def test_dry_run_no_network(tmp_path, capsys):
    def boom(*a, **k):
        raise AssertionError("network used")

    assert mb.main(args(tmp_path, "--dry-run"), post=boom, get=boom) == 0
    assert "no network used" in capsys.readouterr().out


def test_sensitive_free_skipped():
    cand = {"id": "x/y:free", "price_per_1m": {"in": 0, "out": 0}}
    row = {"id": "s", "question": "q", "expected_law": "a", "expected_article": 1}
    row["sensitive"] = True
    rep = mb.run([cand], [row], fake_post, 1.0)
    assert rep["results"]["x/y:free"][0]["skipped"] == "sensitive_on_free"


def test_list_verify(capsys):
    def get(url, headers):
        return {"data": [{"id": "openai/gpt-oss-120b"}]}

    assert mb.main(["--list-verify"], get=get) == 0
    out = capsys.readouterr().out
    assert "FOUND   openai/gpt-oss-120b" in out
    assert "MISSING z-ai/glm-5.3-flash" in out
