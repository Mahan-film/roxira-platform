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
    # task 2 was done but the reviewer failed it: not accepted, its cost is waste
    assert w["accepted"] == 1 and w["failed"] == 1 and w["rejected_by_review"] == 1 and w["unreviewed"] == 0
    assert w["usd_per_accepted"] == pytest.approx(0.30) and w["wasted_usd"] == pytest.approx(0.17)
    assert w["lanes"]["be"] == {"accepted": 1, "usd": pytest.approx(0.30)}
    assert w["reviews"] == {"pass": 1, "fail": 1} and w["unmetered_attempts"] == 2
    assert taskq.weekly_summary(db, 0.01)["accepted"] == 0  # window respected
    fa = taskq.format_weekly_fa(w)
    assert "۰٫" not in fa and "۲" in fa and "دلار" in fa
    en = taskq.format_weekly_en(w)
    assert "cost per accepted task $0.3000" in en and "1 rejected by the reviewer" in en and "not in these numbers" in en
    assert json.loads(json.dumps(w))["accepted"] == 1


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
    assert verdict["verdict"] == "error" and "agent-free-paid" in verdict["note"]  # the last try is the paid group
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


def test_plan_routes_ids_to_openrouter_and_groups_to_gateway():
    """The key-pool gateway serves group names only: raw model ids must never be sent to it."""
    p = review_hook.plan(["meta-llama/llama-3.3-70b-instruct:free", "z-ai/glm-5.3"], "deepseek/deepseek-v4.1-flash", True)
    assert p == [("gateway", "agent-strong-free"), ("openrouter", "meta-llama/llama-3.3-70b-instruct:free"),
                 ("openrouter", "z-ai/glm-5.3"), ("gateway", "agent-free-paid")]
    private = review_hook.plan(["z-ai/glm-5.3"], "deepseek/deepseek-v4.1-flash", False)
    assert ("gateway", "agent-strong-free") not in private  # free tiers may log: public code only
    # author is a gateway group (family unknown): groups could silently serve the author's own vendor, so skip them
    assert review_hook.plan(["z-ai/glm-5.3"], "keypool/agent-strong-free", True) == [("openrouter", "z-ai/glm-5.3")]
    for route, model in p:
        assert route == "gateway" or "/" in model
    assert all(m.startswith("agent-") for r, m in p if r == "gateway")


def test_endpoint_via_forces_route(monkeypatch):
    monkeypatch.setenv("KEYPOOL_MASTER_KEY", "mk")
    monkeypatch.setenv("OPENROUTER_API_KEY_AGENTS", "or")
    assert llm_client.endpoint("openrouter") == (llm_client.DEFAULT_URL, "or", False)
    assert llm_client.endpoint("gateway")[1:] == ("mk", True)
    monkeypatch.delenv("KEYPOOL_MASTER_KEY")
    with pytest.raises(llm_client.LLMError, match="no API key"):
        llm_client.chat_full("agent-strong-free", "s", "p", lane="review", via="gateway")


def test_lane_usage_counts_direct_spend(env, monkeypatch):  # noqa: F811
    home, task = env
    monkeypatch.setenv("KEYPOOL_COST_LOG", str(home / "none.jsonl"))
    add(task, "--lane", "be")
    db = taskq.connect()
    db.execute("INSERT INTO attempts (task_id, ts, step, lane, direct_usd) VALUES (1, ?, 'ds-flash', 'be', 0.75)", (time.time(),))
    db.commit()
    spend, attempts = taskq.Worker(db, 1, 0).lane_usage({"cost_log": str(home / "none.jsonl")})
    assert spend["be"]["usd"] == pytest.approx(0.75) and attempts["be"] == 1


def test_backfill_keeps_direct_spend(env, monkeypatch):  # noqa: F811
    home, task = env
    monkeypatch.setenv("KEYPOOL_COST_LOG", str(home / "none.jsonl"))
    add(task, "--lane", "be")
    db = taskq.connect()
    db.execute("INSERT INTO attempts (task_id, ts, step, lane, direct_usd) VALUES (1, ?, 'ds-flash', 'be', 0.40)", (time.time() - 60,))
    db.execute("INSERT INTO attempts (task_id, ts, step, lane) VALUES (1, ?, 'strong', 'be')", (time.time() - 30,))
    db.commit()
    assert taskq.main(["backfill"]) == 0
    t = get()
    assert t["cost_usd"] == pytest.approx(0.40) and t["unmetered"] == 1  # one measured, one still unmetered


def test_plan_is_free_first_and_paid_group_last():
    entries = [{"id": "z-ai/glm-5.3", "price_per_1m": {"in": 0.079, "out": 4.8}},
               {"id": "meta-llama/llama-3.3-70b-instruct:free", "price_per_1m": {"in": 0, "out": 0}},
               {"id": "mistralai/mistral-small:free", "price_per_1m": {"in": 0, "out": 0}}]
    free = {e["id"] for e in entries if review_hook.is_free(e)}
    assert free == {"meta-llama/llama-3.3-70b-instruct:free", "mistralai/mistral-small:free"}
    p = review_hook.plan([e["id"] for e in entries], "deepseek/deepseek-v4.1-flash", True, free)
    assert [m for _, m in p] == ["agent-strong-free", "meta-llama/llama-3.3-70b-instruct:free", "mistralai/mistral-small:free",
                                "z-ai/glm-5.3", "agent-free-paid"]


class _Resp:
    def __init__(self, model):
        self.body = json.dumps({"model": model, "choices": [{"message": {"content": "ok"}}],
                                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.01}}).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_gateway_call_is_not_logged_locally_and_gets_no_usage_flag(tmp_path, monkeypatch):
    """The key pool already logs a gateway call in requests.jsonl; a second line here would count it twice."""
    monkeypatch.setenv("ROXIRA_AGENTS_HOME", str(tmp_path))
    monkeypatch.setenv("KEYPOOL_MASTER_KEY", "mk")
    monkeypatch.setenv("OPENROUTER_API_KEY_AGENTS", "or")
    sent = []

    def fake_urlopen(req, timeout=0):
        sent.append((req.full_url, json.loads(req.data)))
        return _Resp("gpt-oss-120b")

    monkeypatch.setattr(llm_client.urllib.request, "urlopen", fake_urlopen)
    assert llm_client.chat_full("agent-strong-free", "s", "p", lane="review", task=3, via="gateway") == ("ok", "gpt-oss-120b")
    assert "usage" not in sent[0][1] and sent[0][0].startswith("http://127.0.0.1:4000")
    assert not llm_client.calls_log().exists()
    llm_client.chat_full("z-ai/glm-5.3", "s", "p", lane="review", task=3, via="openrouter")
    assert sent[1][1]["usage"] == {"include": True}
    rec = json.loads(llm_client.calls_log().read_text())
    assert rec["task"] == 3 and rec["lane"] == "review" and rec["response_cost"] == 0.01


def test_gateway_review_cost_counted_once(env, monkeypatch):  # noqa: F811
    home, task = env
    log = home / "requests.jsonl"
    monkeypatch.setenv("KEYPOOL_COST_LOG", str(log))
    add(task, "--lane", "be")
    now = time.time()
    db = taskq.connect()
    db.execute("INSERT INTO attempts (task_id, ts, end_ts, step, lane) VALUES (1, ?, ?, 'review', 'review')", (now - 30, now + 30))
    db.commit()
    log.write_text(json.dumps(rec(now, 0.25)) + "\n")  # the gateway's own line; nothing is written by llm_client
    w = taskq.Worker(db, 1, 0)
    spend, _ = w.lane_usage({"cost_log": str(log), "agent_model_groups": ["agent-*"]})
    assert spend["review"]["usd"] == pytest.approx(0.25)
    w.record_cost(1)
    assert get()["cost_usd"] == pytest.approx(0.25)


def test_direct_spend_is_booked_to_the_day_the_attempt_ended(env, monkeypatch):  # noqa: F811
    home, task = env
    add(task, "--lane", "be")
    db = taskq.connect()
    midnight = lane_budget.day_start(time.time())
    db.execute("INSERT INTO attempts (task_id, ts, end_ts, step, lane, direct_usd) VALUES (1, ?, ?, 'ds-flash', 'be', 0.5)",
               (midnight - 600, midnight + 600))  # started yesterday, ended today
    db.execute("INSERT INTO attempts (task_id, ts, end_ts, step, lane, direct_usd) VALUES (1, ?, ?, 'ds-flash', 'be', 9)",
               (midnight - 7200, midnight - 3600))  # yesterday only
    db.commit()
    spend, _ = taskq.Worker(db, 1, 0).lane_usage({"cost_log": str(home / "none.jsonl")}, now=midnight + 3600)
    assert spend["be"]["usd"] == pytest.approx(0.5)


def test_done_is_not_accepted_until_review_passes(env, monkeypatch):  # noqa: F811
    home, task = env
    told = []
    monkeypatch.setattr(taskq, "notify", told.append)
    monkeypatch.setenv("TASKQ_REVIEW", "1")
    monkeypatch.setenv("TASKQ_BUDGETS", str(home / "none.json"))
    started = []
    monkeypatch.setattr(taskq.Worker, "start_review", lambda self, t, patch, rec, info: started.append(t["id"]))
    monkeypatch.setattr(taskq.Worker, "export_patch", lambda self, t, rec: "/p")
    add(task)
    monkeypatch.setenv("FAKE_OK_STEPS", "ds-flash")
    taskq.main(["run", "--once", "--stagger", "0"])
    assert started == [1] and get()["status"] == "done"
    assert any("در انتظار بازبینی" in t for t in told) and not any("انجام شد" in t for t in told)
    db = taskq.connect()
    db.execute("UPDATE tasks SET review='running', done_ts=? WHERE id=1", (time.time(),))
    db.commit()
    assert taskq.weekly_summary(db, 7)["accepted"] == 0 and taskq.weekly_summary(db, 7)["in_review"] == 1
    db.execute("UPDATE tasks SET review='pass (exit 0)' WHERE id=1")
    db.commit()
    assert taskq.weekly_summary(db, 7)["accepted"] == 1
    # a restart orphans a running review; retry resets the verdict
    db.execute("UPDATE tasks SET review='running' WHERE id=1")
    db.commit()
    taskq.Worker(db, 1, 0).recover()
    assert get()["review"].startswith("error")
    assert taskq.main(["retry", "1"]) == 0 and get()["review"] is None and get()["done_ts"] is None


def test_no_review_notifies_plain_done(env, monkeypatch):  # noqa: F811
    home, task = env
    told = []
    monkeypatch.setattr(taskq, "notify", told.append)
    monkeypatch.setenv("TASKQ_REVIEW", "0")
    monkeypatch.setenv("TASKQ_BUDGETS", str(home / "none.json"))
    add(task)
    monkeypatch.setenv("FAKE_OK_STEPS", "ds-flash")
    taskq.main(["run", "--once", "--stagger", "0"])
    assert any("انجام شد (بدون بازبینی)" in t for t in told)
