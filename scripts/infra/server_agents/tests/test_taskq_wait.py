"""taskq loop condition-wait tests (issue #424): the old fixed time.sleep() is replaced by a wait
that returns early when a task is enqueued or a child finishes, keeping the timeout as hard bound
and --once exit logic identical. Temp DB, fake runner (TASKQ_RUNNER), no network."""

import json
import stat
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import taskq  # noqa: E402

FAKE = """#!{py}
import json, os, sys
a = sys.argv[1:]
home = os.environ["ROXIRA_AGENTS_HOME"]
slug = a[a.index("--slug") + 1]
rec = {{"ok": True, "branch": "agent/20261016-0000-" + slug, "worktree": home + "/wt",
       "exit_code": 0, "files": ["docs/x.md"], "checks_ok": True}}
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
    monkeypatch.delenv("TASKQ_STRONG_ALIAS", raising=False)
    monkeypatch.delenv("TASKQ_MAX_ATTEMPTS_PER_DAY", raising=False)
    monkeypatch.setattr(taskq.Worker, "export_patch", lambda self, t, rec: "/patch/x")
    task = tmp_path / "task.md"
    task.write_text("do the thing\n")
    return tmp_path, task


def test_wait_returns_immediately_when_event_set(env):
    """(a) setting the event makes wait() return at once, well under the timeout."""
    _, _ = env
    w = taskq.Worker(taskq.connect(), 1, 0)
    w.wakeup.set()
    start = time.monotonic()
    assert w.wait(5) is True
    assert time.monotonic() - start < 1
    assert not w.wakeup.is_set()  # consumed, so the next wait blocks normally


def test_wait_times_out_when_nothing_happens(env):
    """(b) with no event, file change or finished child, wait() returns only after the timeout."""
    _, _ = env
    w = taskq.Worker(taskq.connect(), 1, 0)
    start = time.monotonic()
    assert w.wait(0.3) is False
    assert time.monotonic() - start >= 0.3


def test_wait_wakes_on_wakeup_file(env):
    """A `taskq.py add`/`retry` in another process touches the wakeup file; wait() notices."""
    home, _ = env
    home.joinpath(taskq.WAKEUP_FILE).touch()
    w = taskq.Worker(taskq.connect(), 1, 0)
    threading.Timer(0.2, taskq.poke).start()
    start = time.monotonic()
    assert w.wait(5) is True
    assert time.monotonic() - start < 2


def test_wait_wakes_when_child_finishes(env):
    """A finished task/review subprocess wakes wait() so it is reaped without waiting out the bound."""
    _, _ = env
    w = taskq.Worker(taskq.connect(), 1, 0)
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(0.2)"])
    try:
        w.running[1] = {"proc": proc}
        start = time.monotonic()
        assert w.wait(5) is True
        assert time.monotonic() - start < 3
    finally:
        proc.wait()


def test_add_pokes_wakeup_file(env):
    home, task = env
    assert taskq.main(["add", "--slug", "demo", "--task-file", str(task), "--ladder", "ds-flash"]) == 0
    assert (home / taskq.WAKEUP_FILE).is_file()


def test_once_mode_exit_unchanged(env):
    """(c) --once still runs the task to completion and returns (exit logic untouched)."""
    home, task = env
    assert taskq.main(["add", "--slug", "demo", "--task-file", str(task), "--ladder", "ds-flash"]) == 0
    start = time.monotonic()
    assert taskq.main(["run", "--once", "--stagger", "0", "--max-parallel", "1"]) == 0
    assert time.monotonic() - start < 5
    t = taskq.connect().execute("SELECT * FROM tasks WHERE id=1").fetchone()
    assert t["status"] == "done" and t["branch"].endswith("demo-a1")
    assert json.loads(t["files"]) == ["docs/x.md"]
