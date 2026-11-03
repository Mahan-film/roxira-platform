"""Unit tests for scripts/dev/fleet.py: pure helpers and the scheduler. No network, no agents, no git."""
from __future__ import annotations

import importlib.util
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("fleet", HERE.parent / "fleet.py")
fleet = importlib.util.module_from_spec(spec)
sys.modules["fleet"] = fleet
spec.loader.exec_module(fleet)
CFG = fleet.load_config()


def test_extract_areas_from_paths_and_override():
    text = "Edit `scripts/dev/status.sh` and docs/ops/FLEET_RUNBOOK.md; see https://github.com/x/y"
    assert fleet.extract_areas(text, tops={"scripts", "docs"}) == ["scripts/dev", "docs/ops"]
    assert fleet.extract_areas("Areas: output_apps/enterprise_hub/frontend/src/app/x.tsx, docs") == [
        "output_apps/enterprise_hub/frontend", "docs"]
    assert fleet.extract_areas("no paths here") == ["*"]


def test_areas_conflict_is_prefix_based():
    assert fleet.areas_conflict(["scripts/dev"], ["scripts"])
    assert fleet.areas_conflict(["a/b"], ["a/b"])
    assert not fleet.areas_conflict(["scripts/dev"], ["scripts/ops"])
    assert not fleet.areas_conflict(["*"], ["docs"])
    assert fleet.areas_conflict(["*"], ["*"])


def test_rate_limit_detection_and_backoff():
    pat = CFG["rate_limit"]["pattern"]
    assert fleet.parse_rate_limit("Error: 429 Too Many Requests", pat)
    assert fleet.parse_rate_limit("Claude usage limit reached", pat)
    assert not fleet.parse_rate_limit("all tests passed", pat)
    assert fleet.backoff_secs(0, CFG) == 900
    assert fleet.backoff_secs(1, CFG) == 1800
    assert fleet.backoff_secs(20, CFG) == CFG["rate_limit"]["max_backoff_secs"]


def test_sensitive_paths():
    assert fleet.is_sensitive("migrations/001.sql", CFG)
    assert fleet.is_sensitive("db/anything.sql", CFG)
    assert fleet.is_sensitive("scripts/dev/fleet.py", CFG)
    assert not fleet.is_sensitive("docs/ops/FLEET_RUNBOOK.md", CFG)


def pr(**kw):
    base = {"state": "OPEN", "mergeable": "MERGEABLE", "mergeStateStatus": "CLEAN", "files": [{"path": "docs/a.md"}],
            "additions": 3, "deletions": 1, "statusCheckRollup": [{"name": "Pytest (unit)", "status": "COMPLETED", "conclusion": "SUCCESS"}]}
    base.update(kw)
    return base


def test_merge_decision():
    now = time.time()
    assert fleet.merge_decision(pr(), CFG, now)[0] == "merge"
    assert fleet.merge_decision(pr(state="MERGED"), CFG, now)[0] == "merged"
    assert fleet.merge_decision(pr(files=[{"path": ".github/workflows/ci.yml"}]), CFG, now)[0] == "hub"
    assert fleet.merge_decision(pr(additions=2000), CFG, now)[0] == "hub"
    assert fleet.merge_decision(pr(mergeable="CONFLICTING"), CFG, now)[0] == "fail"
    pending = [{"name": "Pytest (unit)", "status": "IN_PROGRESS", "conclusion": ""}]
    assert fleet.merge_decision(pr(statusCheckRollup=pending, mergeStateStatus="BLOCKED"), CFG, now)[0] == "wait"
    red = [{"name": "Frontend gate", "status": "COMPLETED", "conclusion": "FAILURE"}]
    assert fleet.merge_decision(pr(statusCheckRollup=red, mergeStateStatus="BLOCKED"), CFG, now)[0] == "fail"
    quiet = [{"name": "Agent review", "status": "COMPLETED", "conclusion": "FAILURE"}]
    assert fleet.merge_decision(pr(statusCheckRollup=quiet, mergeStateStatus="UNSTABLE"), CFG, now)[0] == "merge"


def test_parse_verdict():
    assert fleet.parse_verdict('noise {"verdict": "PASS", "issues": []} tail')["verdict"] == "pass"
    assert fleet.parse_verdict('{"verdict":"fail","issues":["x"]}')["issues"] == ["x"]
    assert fleet.parse_verdict("no json") is None
    assert fleet.parse_verdict('{"verdict":"maybe"}') is None


def test_pick_lane_balances_and_respects_cooldown():
    job = {}
    assert fleet.pick_lane(job, ["opencode", "claude"], {"opencode": 1}, {}, 100.0) == "claude"
    assert fleet.pick_lane(job, ["opencode", "claude"], {}, {"opencode": 500.0}, 100.0) == "claude"
    assert fleet.pick_lane(job, ["opencode"], {}, {"opencode": 500.0}, 100.0) is None
    assert fleet.pick_lane({"lane_forced": "claude"}, ["opencode", "claude"], {}, {}, 1.0) == "claude"


class FakeProc:
    pid = 4242


def make_job(n, areas, **kw):
    return {"issue": n, "status": "queued", "created": float(n), "areas": areas, "lane_forced": None, "no_merge": False,
            "title": f"t{n}", "body": "b", "locked": False, "pid": None, **kw}


def test_tick_caps_writers_and_locks_areas(tmp_path, monkeypatch):
    store = fleet.Store(tmp_path)
    started = []
    monkeypatch.setattr(fleet.subprocess, "Popen", lambda cmd, **kw: started.append(cmd[-2:]) or FakeProc())
    monkeypatch.setattr(fleet, "alive", lambda pid: True)
    with store.txn() as d:
        d["jobs"] = {str(n): make_job(n, a) for n, a in [(1, ["scripts/dev"]), (2, ["scripts"]), (3, ["docs"]), (4, ["config"]), (5, ["src/x"])]}
    f = fleet.Fleet(CFG, store)
    f.tick(3)
    jobs = store.read()["jobs"]
    assert [j["status"] for j in jobs.values()].count("building") == 3  # cap
    assert jobs["2"]["status"] == "queued" and "lock" in jobs["2"]["note"]  # overlaps #1
    assert {s[0] for s in started} == {"1", "3", "4"}


def test_rate_limited_job_waits_then_resumes(tmp_path, monkeypatch):
    store = fleet.Store(tmp_path)
    with store.txn() as d:
        d["jobs"] = {"7": make_job(7, ["docs"], status="building", lane="opencode", pid=None)}
    f = fleet.Fleet(CFG, store)
    f.rate_limited(7, "opencode")
    d = store.read()
    j = d["jobs"]["7"]
    assert j["status"] == "queued" and j["resume_at"] > time.time() + 800 and d["cooldown"]["opencode"] > time.time()
    monkeypatch.setattr(fleet.subprocess, "Popen", lambda cmd, **kw: FakeProc())
    f.tick(3)
    assert store.read()["jobs"]["7"]["status"] == "queued"  # still waiting
    with store.txn() as d:
        d["jobs"]["7"]["resume_at"] = time.time() - 1
        d["cooldown"] = {}
    f.tick(3)
    assert store.read()["jobs"]["7"]["status"] == "building"


def test_dead_step_is_recovered(tmp_path, monkeypatch):
    store = fleet.Store(tmp_path)
    with store.txn() as d:
        d["jobs"] = {"9": make_job(9, ["docs"], status="reviewing", pid=999999, pr=5)}
    monkeypatch.setattr(fleet, "alive", lambda pid: False)
    started = []
    monkeypatch.setattr(fleet.subprocess, "Popen", lambda cmd, **kw: started.append(cmd[-1]) or FakeProc())
    fleet.Fleet(CFG, store).tick(3)
    assert started == ["review"]
