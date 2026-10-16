"""taskq tests: temp DB, fake runner (TASKQ_RUNNER), no network, no real run_task.sh."""

import json
import os
import stat
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import taskq  # noqa: E402

FAKE = """#!{py}
import json, os, sys
a = sys.argv[1:]
home = os.environ["ROXIRA_AGENTS_HOME"]
open(home + "/calls.log", "a").write(" ".join(a) + "\\n")
slug = a[a.index("--slug") + 1]
step = "ds-flash" if "ds-flash" in a else ("free" if "--gateway" in a else "strong")
ok = step in os.environ.get("FAKE_OK_STEPS", "").split(",")
rec = {{"ok": True, "branch": "agent/20261016-0000-" + slug, "worktree": home + "/wt", "exit_code": 0,
       "files": ["docs/x.md"] if ok else ["docs/x.md"], "checks_ok": ok}}
if not ok:
    rec["checks"] = {{"checks": [{{"name": "ruff", "ok": False, "output": "line1\\nE501 too long"}}]}}
os.makedirs(home + "/logs", exist_ok=True)
open(home + "/logs/results.jsonl", "a").write(json.dumps(rec) + "\\n")
"""


@pytest.fixture()
def env(tmp_path, monkeypatch):
    runner = tmp_path / "fake_runner.py"
    runner.write_text(FAKE.format(py=sys.executable))
    runner.chmod(runner.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("ROXIRA_AGENTS_HOME", str(tmp_path))
    monkeypatch.setenv("TASKQ_RUNNER", str(runner))
    monkeypatch.setenv("TASKQ_NOTIFY", "0")
    monkeypatch.setenv("TASKQ_STRONG_ALIAS", "groq-strong")
    monkeypatch.delenv("TASKQ_MAX_ATTEMPTS_PER_DAY", raising=False)
    monkeypatch.setattr(taskq.Worker, "export_patch", lambda self, t, rec: "/patch/x")
    task = tmp_path / "task.md"
    task.write_text("do the thing\n")
    return tmp_path, task


def add(task, *extra, slug="demo"):
    assert taskq.main(["add", "--slug", slug, "--task-file", str(task), *extra]) == 0


def get(tid=1):
    return taskq.connect().execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()


def run_once(monkeypatch, steps):
    monkeypatch.setenv("FAKE_OK_STEPS", steps)
    taskq.main(["run", "--once", "--stagger", "0", "--max-parallel", "2"])


def calls(home):
    return (home / "calls.log").read_text().splitlines()


def test_success_first_step_public(env, monkeypatch):
    home, task = env
    add(task, "--public", "--scope", "docs/")
    run_once(monkeypatch, "free")
    t = get()
    assert t["status"] == "done" and t["patch"] == "/patch/x" and t["branch"].endswith("demo-a1")
    assert json.loads(t["files"]) == ["docs/x.md"]
    c = calls(home)
    assert len(c) == 1 and "--gateway --public" in c[0] and "--scope docs/" in c[0] and "--slug demo-a1" in c[0]


def test_ladder_escalates_and_notes_failure(env, monkeypatch):
    home, task = env
    add(task, "--public")
    run_once(monkeypatch, "strong")
    t = get()
    assert t["status"] == "done" and t["attempts"] == 3
    c = calls(home)
    assert "--gateway" in c[0] and "--model ds-flash" in c[1] and "--model groq-strong" in c[2]
    assert "-a2" in c[1] and "-a3" in c[2]
    note = Path(t["work_file"]).read_text()
    assert "previous attempt failed" in note and "ruff" in note and "E501 too long" in note
    assert task.read_text() == "do the thing\n"  # original untouched


def test_ladder_exhausted_fails(env, monkeypatch):
    _, task = env
    add(task, "--public")
    run_once(monkeypatch, "")
    assert get()["status"] == "failed" and get()["attempts"] == 3


def test_free_step_skipped_for_non_public(env, monkeypatch):
    home, task = env
    add(task)
    run_once(monkeypatch, "ds-flash")
    assert get()["status"] == "done"
    c = calls(home)
    assert len(c) == 1 and "--gateway" not in c[0] and "--public" not in c[0]


def test_strong_skipped_without_alias(env, monkeypatch):
    home, task = env
    monkeypatch.delenv("TASKQ_STRONG_ALIAS")
    add(task)
    run_once(monkeypatch, "strong")
    assert get()["status"] == "failed" and len(calls(home)) == 1


def test_daily_budget_stops_new_attempts(env, monkeypatch):
    home, task = env
    monkeypatch.setenv("TASKQ_MAX_ATTEMPTS_PER_DAY", "1")
    add(task, "--public")
    run_once(monkeypatch, "")
    t = get()
    assert len(calls(home)) == 1 and t["status"] == "queued" and t["attempts"] == 1


def test_stuck_running_goes_back_to_queue(env, monkeypatch):
    home, task = env
    add(task)
    db = taskq.connect()
    taskq.update(db, 1, status="running", pid=2**22 + 12345)
    taskq.Worker(db, 1, 0).recover()
    assert get()["status"] == "queued" and get()["pid"] is None


def test_priority_cancel_retry(env, monkeypatch):
    home, task = env
    add(task, slug="low")
    add(task, "--priority", "5", slug="high")
    assert taskq.main(["cancel", "1"]) == 0 and get(1)["status"] == "cancelled"
    assert taskq.main(["retry", "1"]) == 0 and get(1)["status"] == "queued"
    monkeypatch.setenv("FAKE_OK_STEPS", "ds-flash")
    w = taskq.Worker(taskq.connect(), 1, 0)
    w.tick()
    assert get(2)["status"] == "running" and get(1)["status"] == "queued"
    w.running[2]["proc"].wait()


def test_failing_checks_reads_workbench_format(tmp_path):
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"ok": False, "groups": [
        {"name": "frontend:tsc", "status": "fail", "tail": "a\nerror TS2304: Cannot find name 'x'"},
        {"name": "frontend:eslint", "status": "pass", "tail": ""}]}))
    note = taskq.failing_checks({"checks": str(p)})
    assert "frontend:tsc" in note and "TS2304" in note and "eslint" not in note
