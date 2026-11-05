"""Offline test for scripts/auto_review_system.py check_llm routing (no network)."""
import importlib.util
import json
import pathlib

_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "auto_review_system.py"


def _load():
    spec = importlib.util.spec_from_file_location("auto_review_under_test", _PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_check_llm_routes_free_first_and_reports_served(monkeypatch, tmp_path):
    monkeypatch.setenv("ROXIRA_LLM_COST_LOG", str(tmp_path / "cost.jsonl"))
    ar = _load()
    lr = ar.llm_route
    calls = []

    def bad(messages, max_tokens):
        calls.append("free")
        raise lr.AttemptError("http429")

    def good(messages, max_tokens):
        calls.append("paid")
        return "OK", 10, 2
    atts = [lr.Attempt("fake/free", "free", False, bad, public_only=True),
            lr.Attempt("fake/paid", "cheap_agent", True, good, price_per_1m=(0.0, 0.0))]
    monkeypatch.setattr(lr, "auto_review_attempts", lambda: atts)
    res = ar.check_llm()
    assert res["ok"] is True and "fake/paid" in res["detail"] and calls == ["free", "paid"]
    logged = [json.loads(line) for line in (tmp_path / "cost.jsonl").read_text().splitlines()]
    assert [r["attempt"] for r in logged] == ["fake/free", "fake/paid"]  # one line per call, serving attempt recorded
    assert logged[-1]["ok"] is True and logged[-1]["task"] == "auto_review" and not logged[0]["ok"]


def test_check_llm_reports_failure_when_all_attempts_fail(monkeypatch, tmp_path):
    monkeypatch.setenv("ROXIRA_LLM_COST_LOG", str(tmp_path / "cost.jsonl"))
    ar = _load()
    lr = ar.llm_route

    def bad(messages, max_tokens):
        raise lr.AttemptError("nokey")
    monkeypatch.setattr(lr, "auto_review_attempts",
                        lambda: [lr.Attempt("fake/free", "free", False, bad, public_only=True)])
    res = ar.check_llm()
    assert res["ok"] is False and "AllAttemptsFailed" in res["detail"]
