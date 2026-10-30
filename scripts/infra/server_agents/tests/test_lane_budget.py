"""lane_budget.py + taskq per-lane budget tests: fixture cost log, temp DB, fake runner, no network."""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import lane_budget
import taskq
from test_taskq import add, calls, env, get

FIX = HERE / "fixtures"


def ts(h, m=0, day=22):
    return datetime(2026, 10, day, h, m, tzinfo=timezone.utc).timestamp()


CFG = {"agent_model_groups": ["agent-*"], "default": {"usd_per_day": 1.0},
       "lanes": {"be": {"usd_per_day": 0.3, "tokens_per_day": 100000, "attempts_per_day": 3},
                 "fe": {"tokens_per_day": 2000}, "review": {"usd_per_day": 0.2}}}


def test_spend_attribution_by_window_and_lane_field():
    recs = lane_budget.read_records([FIX / "cost_log.jsonl"], since=ts(0))
    assert len(recs) == 5  # yesterday's line and the broken line are skipped
    windows = [("be", ts(7, 55), ts(8, 30)), ("fe", ts(8, 5), ts(8, 15)), ("data", ts(10), ts(10, 30))]
    spend = lane_budget.lane_spend(recs, windows, CFG["agent_model_groups"], now=ts(12))
    assert spend["be"]["usd"] == pytest.approx(0.20) and spend["fe"]["usd"] == pytest.approx(0.20)  # split 0.40
    assert spend["be"]["tokens"] == pytest.approx(1500 + 2000)
    assert spend["review"] == {"usd": 0.25, "tokens": 2300}  # explicit lane field
    assert "data" not in spend  # the 11:00 call is outside every window; product-cheap is not an agent group


def test_open_window_runs_until_now():
    recs = lane_budget.read_records([FIX / "cost_log.jsonl"], since=ts(0))
    spend = lane_budget.lane_spend(recs, [("data", ts(10), None)], ["agent-*"], now=ts(12))
    assert spend["data"]["usd"] == pytest.approx(9.0)


def test_caps_and_over_budget():
    assert lane_budget.caps(CFG, "BE")["usd_per_day"] == 0.3
    assert lane_budget.caps(CFG, "unknown") == {"usd_per_day": 1.0, "tokens_per_day": 0.0, "attempts_per_day": 0.0}
    assert lane_budget.over_budget("be", {"usd": 0.31}, 0, CFG).startswith("$0.3100")
    assert "tokens" in lane_budget.over_budget("fe", {"usd": 0, "tokens": 2000}, 0, CFG)
    assert "attempts" in lane_budget.over_budget("be", {}, 3, CFG)
    assert lane_budget.over_budget("be", {"usd": 0.1, "tokens": 10}, 2, CFG) == ""
    assert lane_budget.over_budget("anything", {"usd": 100}, 100, {}) == ""  # no config = no caps


def test_global_cap_env_wins(monkeypatch):
    monkeypatch.delenv("TASKQ_MAX_ATTEMPTS_PER_DAY", raising=False)
    assert lane_budget.global_attempt_cap({}) == 30
    assert lane_budget.global_attempt_cap({"global": {"attempts_per_day": 60}}) == 60
    monkeypatch.setenv("TASKQ_MAX_ATTEMPTS_PER_DAY", "5")
    assert lane_budget.global_attempt_cap({"global": {"attempts_per_day": 60}}) == 5


def test_shipped_config_parses():
    cfg = lane_budget.load_config(HERE.parent / "lane_budgets.json")
    assert set(cfg["lanes"]) >= {"be", "fe", "data", "test", "review"}
    assert cfg["cost_log"] == "/var/log/roxira-keypool/requests.jsonl"


@pytest.fixture()
def budgets(env, monkeypatch):  # noqa: F811 (env comes from test_taskq)
    home, task = env
    cfg = home / "budgets.json"
    cfg.write_text(json.dumps(CFG))
    monkeypatch.setenv("TASKQ_BUDGETS", str(cfg))
    monkeypatch.setenv("KEYPOOL_COST_LOG", str(home / "requests.jsonl"))
    return home, task


def test_over_budget_lane_is_skipped_others_run(budgets, monkeypatch):
    home, task = budgets
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    (home / "requests.jsonl").write_text(json.dumps(
        {"ts": now, "model_group": "x", "response_cost": 0.5, "prompt_tokens": 1, "completion_tokens": 1, "lane": "be"}) + "\n")
    told = []
    monkeypatch.setattr(taskq, "notify", told.append)
    add(task, "--lane", "be", "--priority", "9", slug="be-task")
    add(task, "--lane", "fe", slug="fe-task")
    monkeypatch.setenv("FAKE_OK_STEPS", "ds-flash")
    taskq.main(["run", "--once", "--stagger", "0", "--max-parallel", "2"])
    assert get(1)["status"] == "queued" and get(2)["status"] == "done"
    assert len(calls(home)) == 1 and "fe-task" in calls(home)[0]
    assert sum("lane be" in t for t in told) == 1  # told once, not every tick


def test_lane_attempt_cap(budgets, monkeypatch):
    _, task = budgets
    add(task, "--lane", "be")  # three-step ladder, all fail; be cap is 3 attempts/day
    add(task, "--lane", "be", slug="second")
    monkeypatch.setenv("FAKE_OK_STEPS", "")
    taskq.main(["run", "--once", "--stagger", "0", "--max-parallel", "1"])
    assert get(1)["status"] == "failed" and get(1)["attempts"] == 2  # free step skipped (not public)
    assert get(2)["attempts"] == 1 and get(2)["status"] == "queued"
    db = taskq.connect()
    assert db.execute("SELECT COUNT(*) FROM attempts WHERE lane='be' AND end_ts IS NOT NULL").fetchone()[0] == 3


def test_budget_command(budgets, capsys):
    _, task = budgets
    add(task, "--lane", "fe")
    assert taskq.main(["budget"]) == 0
    out = capsys.readouterr().out
    assert "global attempts cap" in out and out.count("\n") >= 5 and "be " in out


def test_old_db_is_migrated(tmp_path, monkeypatch):
    import sqlite3
    db_path = tmp_path / "old.db"
    old = sqlite3.connect(db_path)
    old.executescript("CREATE TABLE tasks (id INTEGER PRIMARY KEY, slug TEXT);"
                      "CREATE TABLE attempts (task_id INTEGER, ts REAL NOT NULL, step TEXT);"
                      "INSERT INTO attempts VALUES (1, 1.0, 'free');")
    old.commit()
    old.close()
    monkeypatch.setenv("TASKQ_DB", str(db_path))
    db = taskq.connect()
    cols = {r[1] for r in db.execute("PRAGMA table_info(attempts)")}
    assert {"lane", "end_ts"} <= cols and {"lane", "review"} <= {r[1] for r in db.execute("PRAGMA table_info(tasks)")}
    assert db.execute("SELECT lane FROM attempts").fetchone()[0] == ""
