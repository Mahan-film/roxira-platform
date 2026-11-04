from __future__ import annotations

import importlib.util
import json
import pathlib

import pytest

_spec = importlib.util.spec_from_file_location("llm_route", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "dev" / "llm_route.py")
lr = importlib.util.module_from_spec(_spec)
import sys
sys.modules["llm_route"] = lr
_spec.loader.exec_module(lr)

MSG = [{"role": "user", "content": "x"}]


def ok(text="fine", tin=1000, tout=1000):
    return lambda m, n: (text, tin, tout)


def bad(kind):
    def f(m, n):
        raise lr.AttemptError(kind)
    return f


def test_falls_back_on_error_and_records_served(tmp_path):
    log = tmp_path / "c.jsonl"
    atts = [lr.Attempt("a", "reviewer", True, bad("http403")), lr.Attempt("b", "reviewer", False, ok(), public_only=True)]
    res = lr.route("review_desk", MSG, atts, public=True, log_path=log)
    assert res.served == "b" and res.attempts == [("a", "http403"), ("b", "ok")]
    recs = [json.loads(x) for x in log.read_text().splitlines()]
    assert [r["attempt"] for r in recs] == ["a", "b"] and recs[1]["ok"] is True


def test_empty_answer_counts_as_failure(tmp_path):
    atts = [lr.Attempt("a", "reviewer", True, ok("  ")), lr.Attempt("b", "reviewer", True, ok("yes"))]
    assert lr.route("review_desk", MSG, atts, log_path=tmp_path / "c").served == "b"


def test_public_only_attempts_skipped_for_private_payload(tmp_path):
    atts = [lr.Attempt("free", "reviewer", False, ok(), public_only=True)]
    with pytest.raises(lr.AllAttemptsFailed) as e:
        lr.route("review_desk", MSG, atts, public=False, log_path=tmp_path / "c")
    assert e.value.attempts == [("free", "skipped:data-policy")]


def test_paid_attempt_refused_after_role_cap(tmp_path, monkeypatch):
    log = tmp_path / "c.jsonl"
    cap = lr.model_registry.role_daily_cap_usd("reviewer")
    from datetime import datetime, timezone
    log.write_text(json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "role": "reviewer", "cost_usd": cap + 0.01}) + "\n")
    atts = [lr.Attempt("paid", "reviewer", True, ok()), lr.Attempt("free", "reviewer", False, ok("f"), public_only=True)]
    res = lr.route("review_desk", MSG, atts, public=True, log_path=log)
    assert res.served == "free" and res.attempts[0] == ("paid", "skipped:cap")


def test_cost_is_priced_from_usage(tmp_path):
    res = lr.route("review_desk", MSG, [lr.Attempt("p", "reviewer", True, ok(tin=1_000_000, tout=0), (0.5, 1.0))], log_path=tmp_path / "c")
    assert res.cost_usd == pytest.approx(0.5)


def test_unknown_task_raises(tmp_path):
    with pytest.raises(lr.model_registry.ModelRegistryError):
        lr.route("nope", MSG, [], log_path=tmp_path / "c")


def test_review_chain_has_no_claude_or_forbidden_model():
    for a in lr.review_attempts():
        assert "claude" not in a.name and "anthropic" not in a.name
        assert not lr.model_registry.is_forbidden_model_id(a.name)
    assert lr.review_attempts()[0].name.startswith("openrouter/deepseek")


def test_cap_reached_is_a_distinct_error_when_only_cap_blocked(tmp_path):
    from datetime import datetime, timezone
    log = tmp_path / "c.jsonl"
    log.write_text(json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "role": "reviewer", "cost_usd": 99}) + "\n")
    with pytest.raises(lr.CapReached):
        lr.route("review_desk", MSG, [lr.Attempt("paid", "reviewer", True, ok())], log_path=log)


def test_all_failed_when_every_attempt_errors(tmp_path):
    with pytest.raises(lr.AllAttemptsFailed):
        lr.route("review_desk", MSG, [lr.Attempt("a", "reviewer", True, bad("nokey")), lr.Attempt("b", "reviewer", True, bad("badjson"))], log_path=tmp_path / "c")


def test_load_env_file_does_not_override_and_strips_quotes(tmp_path, monkeypatch):
    f = tmp_path / "e.env"
    f.write_text("export A_X=\"one\"\nB_X='two'\n# c\nC_X=keep\n")
    monkeypatch.setenv("C_X", "already")
    lr.load_env_file(str(f))
    import os
    assert (os.environ["A_X"], os.environ["B_X"], os.environ["C_X"]) == ("one", "two", "already")
