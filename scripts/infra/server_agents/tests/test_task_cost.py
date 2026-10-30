"""Cost per accepted task: attribution, weekly report, gateway reviewer. Temp DB, fake runner, mocked model."""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import lane_budget  # noqa: E402
import llm_client  # noqa: E402
import review_hook  # noqa: E402
import taskq  # noqa: E402
from test_taskq import add, env, get  # noqa: E402,F401


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat().replace("+00:00", "Z")


def rec(t, cost, group="agent-strong-free", **extra):
    return {"ts": iso(t), "model_group": group, "prompt_tokens": 100, "completion_tokens": 50, "response_cost": cost, **extra}


def test_task_spend_split_tag_and_ignored():
    t0 = 1_800_000_000.0
    records = [(t0 + 5, rec(t0 + 5, 0.4)),                      # two attempts overlap: 0.2 each
               (t0 + 50, rec(t0 + 50, 0.1)),                    # only task 1 running
               (t0 + 5, rec(t0 + 5, 9.0, group="product-cheap")),  # product traffic: ignored
               (t0 + 5, rec(t0 + 5, 0.3, lane="review", task=2)),  # tagged review call: task 2 directly
               (t0 + 5, rec(t0 + 5, 7.0, lane="be"))]           # lane-only record: not a task cost
    windows = [(1, t0, t0 + 100), (2, t0, t0 + 20)]
    s = lane_budget.task_spend(records, windows, ["agent-*"], t0 + 200)
    assert s[1]["usd"] == pytest.approx(0.3) and s[2]["usd"] == pytest.approx(0.5)
    assert s[1]["tokens"] == pytest.approx(75 + 150)


def test_cost_recorded_on_done_task_and_failed_attempts_count(env, monkeypatch):  # noqa: F811
    home, task = env
    log = home / "requests.jsonl"
    monkeypatch.setenv("KEYPOOL_COST_LOG", str(log))
    monkeypatch.setenv("TASKQ_REVIEW", "0")
    monkeypatch.setenv("TASKQ_BUDGETS", str(home / "none.json"))
    # The fake runner is instant, so write the cost line from inside it: patch Worker.finish to log a call
    # inside the attempt window first (one failed attempt, one accepted attempt = 0.02 + 0.03).
    real_finish = taskq.Worker.finish
    costs = iter([0.02, 0.03])

    def finish(self, tid, info):
        with open(log, "a") as fh:
            fh.write(json.dumps(rec(time.time(), next(costs), group="best-free")) + "\n")
        real_finish(self, tid, info)

    monkeypatch.setattr(taskq.Worker, "finish", finish)
    add(task, "--lane", "be", "--public", "--ladder", "free,ds-flash")
    monkeypatch.setenv("FAKE_OK_STEPS", "ds-flash")
    taskq.main(["run", "--once", "--stagger", "0"])
    t = get()
    assert t["status"] == "done" and t["done_ts"] and t["attempts"] == 2
    assert t["cost_usd"] == pytest.approx(0.05) and t["tokens"] == 300
    assert t["unmetered"] == 1  # the ds-flash attempt goes direct to OpenRouter


def test_weekly_summary_and_texts(env):  # noqa: F811
    home, task = env
    add(task, slug="a")
    add(task, slug="b")
    add(task, slug="c")
    db = taskq.connect()
    now = time.time()
    db.execute("UPDATE tasks SET status='done', cost_usd=0.30, tokens=900, attempts=2, done_ts=?, lane='be', review='pass (exit 0)' WHERE id=1", (now - 3600,))
    db.execute("UPDATE tasks SET status='done', cost_usd=0.10, tokens=100, attempts=1, done_ts=?, lane='be', review='fail (exit 1)' WHERE id=2", (now - 86400,))
    db.execute("UPDATE tasks SET status='failed', cost_usd=0.07, unmetered=2, reason='checks failed', updated=? WHERE id=3", (now - 7200,))
    db.commit()
    w = taskq.weekly_summary(db, 7)
    assert w["accepted"] == 2 and w["failed"] == 1
    assert w["usd_per_accepted"] == pytest.approx(0.20) and w["wasted_usd"] == pytest.approx(0.07)
    assert w["lanes"]["be"] == {"accepted": 2, "usd": pytest.approx(0.40)}
    assert w["reviews"] == {"pass": 1, "fail": 1} and w["unmetered_attempts"] == 2
    assert taskq.weekly_summary(db, 0.01)["accepted"] == 0  # window respected
    fa = taskq.format_weekly_fa(w)
    assert "۰٫" not in fa and "۲" in fa and "دلار" in fa
    en = taskq.format_weekly_en(w)
    assert "cost per accepted task $0.2000" in en and "not in these numbers" in en
    assert json.loads(json.dumps(w))["accepted"] == 2


def test_report_command_empty(env, capsys):  # noqa: F811
    assert taskq.main(["report"]) == 0
    assert "0 accepted" in capsys.readouterr().out


def test_endpoint_prefers_gateway(monkeypatch):
    for v in ("FACTORY_LLM_URL", "KEYPOOL_MASTER_KEY", "OPENROUTER_API_KEY_AGENTS", "AGENT_GATEWAY_URL"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY_AGENTS", "or")
    assert llm_client.endpoint() == (llm_client.DEFAULT_URL, "or", False)
    monkeypatch.setenv("KEYPOOL_MASTER_KEY", "mk")
    assert llm_client.endpoint() == ("http://127.0.0.1:4000/v1/chat/completions", "mk", True)


def test_review_rejects_same_family_fallback(monkeypatch):
    """The gateway may fall back to the author's vendor; that reply must not count as a cross-family review."""
    served = iter(["deepseek/deepseek-v4.1-flash", "openai/gpt-oss-120b"])
    seen = []

    def fake(model, *a, **kw):
        seen.append((model, kw.get("task")))
        return (HERE / "fixtures" / "review_reply_pass.txt").read_text(), next(served)

    monkeypatch.setattr(llm_client, "chat_full", fake)
    who, verdict = review_hook.review(["z-ai/glm-5.3", "mistralai/m"], "deepseek/deepseek-v4.1-flash", False, "p", task=7)
    assert who == "openai/gpt-oss-120b" and verdict["verdict"] == "pass"
    assert seen == [("z-ai/glm-5.3", 7), ("mistralai/m", 7)]


def test_review_errors_when_nobody_answers(monkeypatch):
    def boom(*a, **kw):
        raise llm_client.LLMError("HTTP call failed: HTTPError")

    monkeypatch.setattr(llm_client, "chat_full", boom)
    who, verdict = review_hook.review(["z-ai/glm-5.3"], "deepseek/x", True, "p")
    assert verdict["verdict"] == "error" and "agent-strong-free" in verdict["note"]  # public: free group tried last
    _, closed = review_hook.review([], "deepseek/x", False, "p")
    assert closed["verdict"] == "error"


def test_direct_openrouter_usage_delta_is_task_cost(env, monkeypatch):  # noqa: F811
    home, task = env
    monkeypatch.setenv("TASKQ_REVIEW", "0")
    monkeypatch.setenv("KEYPOOL_COST_LOG", str(home / "none.jsonl"))
    readings = iter([10.00, 10.12])  # key usage before and after the ds-flash attempt
    monkeypatch.setattr(taskq, "openrouter_usage", lambda: next(readings))
    add(task, "--lane", "be", "--ladder", "ds-flash")
    monkeypatch.setenv("FAKE_OK_STEPS", "ds-flash")
    taskq.main(["run", "--once", "--stagger", "0"])
    t = get()
    assert t["status"] == "done" and t["cost_usd"] == pytest.approx(0.12) and t["unmetered"] == 0


def test_no_key_means_unmetered_not_zero_cost(env, monkeypatch):  # noqa: F811
    home, task = env
    monkeypatch.setenv("TASKQ_REVIEW", "0")
    monkeypatch.delenv("OPENROUTER_API_KEY_AGENTS", raising=False)
    monkeypatch.setenv("KEYPOOL_COST_LOG", str(home / "none.jsonl"))
    add(task, "--ladder", "ds-flash")
    monkeypatch.setenv("FAKE_OK_STEPS", "ds-flash")
    taskq.main(["run", "--once", "--stagger", "0"])
    assert get()["unmetered"] == 1
