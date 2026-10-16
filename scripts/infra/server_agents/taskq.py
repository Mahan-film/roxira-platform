#!/usr/bin/env python3
"""Task queue + model escalation ladder over run_task.sh (factory milestone F2).

CLI over a SQLite DB (default /var/lib/roxira-agents/taskq.db); runs on the server as root.
  taskq.py add --slug S --task-file F [--scope P ...] [--public] [--priority N] [--accept CMD] [--ladder free,ds-flash,strong]
  taskq.py list [--status S] | show ID | cancel ID | retry ID
  taskq.py run [--max-parallel 3] [--stagger 15] [--once]

Ladder steps: best = --gateway --public --tier best (gemini-best), free = run_task.sh --gateway --public (public tasks only), ds-flash = --model ds-flash,
strong = --model $TASKQ_STRONG_ALIAS (skipped when unset). A failed attempt moves to the next step with
the failure reason appended to a copy of the task file. Stdlib only.

Env: ROXIRA_AGENTS_HOME (state dir), TASKQ_DB, TASKQ_RUNNER (run_task.sh path), TASKQ_STRONG_ALIAS,
TASKQ_MAX_ATTEMPTS_PER_DAY (default 30), TASKQ_NOTIFY=0 (no bot messages).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
NOTIFY = HERE.parent.parent / "ops" / "notify" / "notify.py"
STATES = ("queued", "running", "done", "failed", "cancelled")
DEFAULT_LADDER = "best,free,ds-flash,strong"


def state_dir() -> Path:
    return Path(os.environ.get("ROXIRA_AGENTS_HOME", "/var/lib/roxira-agents"))


def runner_path() -> str:
    return os.environ.get("TASKQ_RUNNER") or str(HERE / "run_task.sh")


def connect() -> sqlite3.Connection:
    path = Path(os.environ.get("TASKQ_DB") or state_dir() / "taskq.db")
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, task_file TEXT NOT NULL,
          work_file TEXT, scopes TEXT NOT NULL DEFAULT '[]', public INTEGER NOT NULL DEFAULT 0,
          priority INTEGER NOT NULL DEFAULT 0, accept TEXT, ladder TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued', step_idx INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0, pid INTEGER, reason TEXT, branch TEXT, worktree TEXT,
          files TEXT, checks TEXT, patch TEXT, created REAL NOT NULL, updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts (task_id INTEGER, ts REAL NOT NULL, step TEXT);
        """
    )
    return db


def notify(text: str) -> None:
    """Best effort one-liner to the owner bot; never raises."""
    if os.environ.get("TASKQ_NOTIFY") == "0" or not NOTIFY.is_file():
        return
    try:
        subprocess.run([sys.executable, str(NOTIFY), text], capture_output=True, timeout=30, check=False)
    except Exception:  # noqa: BLE001
        pass


def update(db: sqlite3.Connection, tid: int, **cols) -> None:
    cols["updated"] = time.time()
    keys = ", ".join(f"{k}=?" for k in cols)
    db.execute(f"UPDATE tasks SET {keys} WHERE id=?", (*cols.values(), tid))
    db.commit()


def alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


# ---------------------------------------------------------------- ladder
def step_args(step: str, public: bool) -> list[str] | None:
    """run_task.sh model arguments for a ladder step, or None when the step must be skipped."""
    if step == "best":  # Gemini quality-first ladder (free AI Studio keys): public tasks only, like "free"
        return ["--gateway", "--public", "--tier", "best"] if public else None
    if step == "free":
        return ["--gateway", "--public"] if public else None
    if step == "ds-flash":
        return ["--model", "ds-flash"]
    if step == "strong":
        alias = os.environ.get("TASKQ_STRONG_ALIAS", "").strip()
        return ["--model", alias] if alias else None
    return None


def next_step(task: sqlite3.Row) -> tuple[int, str, list[str]] | None:
    ladder = json.loads(task["ladder"])
    for i in range(task["step_idx"], len(ladder)):
        args = step_args(ladder[i], bool(task["public"]))
        if args is not None:
            return i, ladder[i], args
    return None


def attempt_slug(slug: str, n: int) -> str:
    suffix = f"-a{n}"
    return (slug[: 28 - len(suffix)] + suffix).strip("-")


# ---------------------------------------------------------------- results
def read_result(since: int, slug: str) -> dict | None:
    """Last results.jsonl record written after offset `since` whose branch ends with -<slug>."""
    path = state_dir() / "logs" / "results.jsonl"
    try:
        with open(path, "rb") as fh:
            fh.seek(since)
            lines = fh.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return None
    found = None
    for line in lines:
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if isinstance(rec, dict) and str(rec.get("branch", "")).endswith("-" + slug):
            found = rec
    return found


def results_size() -> int:
    try:
        return (state_dir() / "logs" / "results.jsonl").stat().st_size
    except OSError:
        return 0


def load_checks(rec: dict):
    """The checks JSON referenced from (or embedded in) the result record; None when absent."""
    ref = rec.get("checks") or rec.get("checks_path") or rec.get("checks_file")
    if isinstance(ref, str):
        try:
            return json.loads(Path(ref).read_text())
        except (OSError, ValueError):
            return None
    return ref


def failing_checks(rec: dict) -> str:
    """Names + output tails of failed workbench groups (workbench.sh JSON: {groups:[{name,status,tail}], ok})."""
    data = load_checks(rec)
    items = data.get("groups", data.get("checks", [])) if isinstance(data, dict) else data
    parts = []
    for c in items if isinstance(items, list) else []:
        if not isinstance(c, dict):
            continue
        failed = c.get("status") in ("fail", "timeout") if "status" in c else c.get("ok", True) is False
        if not failed:
            continue
        out = str(c.get("tail") or c.get("output") or "")
        parts.append(f"{c.get('name', '?')}: " + "\n".join(out.strip().splitlines()[-12:]))
    return "; ".join(parts)[:1500]


def judge(rec: dict | None) -> tuple[bool, str]:
    if rec is None:
        return False, "no result record from run_task.sh"
    if not rec.get("ok"):
        return False, f"runner not ok (exit {rec.get('exit_code')}, violations {rec.get('violations') or 'none'})"
    if rec.get("checks_ok") is False:
        return False, "checks failed: " + (failing_checks(rec) or "no detail")
    if not rec.get("files"):
        return False, "the agent changed no files"
    return True, ""


# ---------------------------------------------------------------- worker
class Worker:
    def __init__(self, db: sqlite3.Connection, max_parallel: int, stagger: float):
        self.db, self.max_parallel, self.stagger = db, max_parallel, stagger
        self.running: dict[int, dict] = {}
        self.last_start = 0.0
        self.budget_told = False

    def recover(self) -> None:
        for t in self.db.execute("SELECT * FROM tasks WHERE status='running'").fetchall():
            if not alive(t["pid"]):
                update(self.db, t["id"], status="queued", pid=None)
                notify(f"تسک {t['slug']}: پس از ری‌استارت دوباره در صف")

    def budget_left(self) -> bool:
        limit = int(os.environ.get("TASKQ_MAX_ATTEMPTS_PER_DAY", "30"))
        used = self.db.execute("SELECT COUNT(*) FROM attempts WHERE ts>=?", (time.time() - 86400,)).fetchone()[0]
        if used >= limit:
            if not self.budget_told:
                notify(f"صف تسک‌ها: سقف {limit} تلاش در ۲۴ ساعت پر شد؛ تلاش جدید شروع نمی‌شود")
                self.budget_told = True
            return False
        self.budget_told = False
        return True

    def start(self, t: sqlite3.Row) -> None:
        step = next_step(t)
        if step is None:
            update(self.db, t["id"], status="failed", reason=(t["reason"] or "") + " | no usable ladder step left")
            notify(f"تسک {t['slug']}: شکست، مرحله‌ای باقی نمانده")
            return
        idx, name, margs = step
        n = t["attempts"] + 1
        slug = attempt_slug(t["slug"], n)
        work = t["work_file"] or str(state_dir() / "taskq" / f"{t['id']}.md")
        Path(work).parent.mkdir(parents=True, exist_ok=True)
        if not t["work_file"]:
            shutil.copyfile(t["task_file"], work)
        cmd = [runner_path(), "--task-file", work, "--slug", slug, *margs]
        for s in json.loads(t["scopes"]):
            cmd += ["--scope", s]
        if t["public"] and "--public" not in cmd:
            cmd.append("--public")
        offset = results_size()
        with open(Path(work).parent / f"{t['id']}-a{n}.out", "wb") as logf:
            proc = subprocess.Popen(cmd, stdout=logf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
        self.db.execute("INSERT INTO attempts VALUES (?,?,?)", (t["id"], time.time(), name))
        update(self.db, t["id"], status="running", pid=proc.pid, attempts=n, step_idx=idx, work_file=work)
        self.running[t["id"]] = {"proc": proc, "slug": slug, "offset": offset, "step": name}
        self.last_start = time.time()
        notify(f"تسک {t['slug']}: شروع، مرحله {name} (تلاش {n})")

    def finish(self, tid: int, info: dict) -> None:
        t = self.db.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
        if t is None or t["status"] != "running":  # cancelled meanwhile
            return
        rec = read_result(info["offset"], info["slug"])
        ok, reason = judge(rec)
        if ok:
            patch = self.export_patch(t, rec)
            update(self.db, tid, status="done", pid=None, reason=None, branch=rec.get("branch"),
                   worktree=rec.get("worktree"), files=json.dumps(rec.get("files")),
                   checks=json.dumps(rec.get("checks")) if rec.get("checks") is not None else None, patch=patch)
            notify(f"تسک {t['slug']}: انجام شد، مرحله {info['step']}")
            return
        with open(t["work_file"], "a", encoding="utf-8") as fh:
            fh.write(f"\n\nprevious attempt failed: {reason}\n")
        more = next_step({**dict(t), "step_idx": t["step_idx"] + 1}) is not None
        update(self.db, tid, status="queued" if more else "failed", pid=None, step_idx=t["step_idx"] + 1,
               reason=reason, branch=(rec or {}).get("branch"), worktree=(rec or {}).get("worktree"))
        notify(f"تسک {t['slug']}: شکست، مرحله {info['step']}" + ("" if more else " (پایان نردبان)"))

    def export_patch(self, t: sqlite3.Row, rec: dict) -> str | None:
        out = state_dir() / "patches" / f"{t['id']}-{t['slug']}.patch"
        try:
            out.parent.mkdir(parents=True, exist_ok=True)
            res = subprocess.run(["git", "-c", "safe.directory=*", "-C", str(rec.get("worktree")), "format-patch", "-1", "--stdout"],
                                 capture_output=True, timeout=60, check=True)
            out.write_bytes(res.stdout)
            return str(out)
        except Exception as exc:  # noqa: BLE001
            notify(f"تسک {t['slug']}: خروجی گرفتن patch ناموفق بود ({type(exc).__name__})")
            return None

    def reap(self) -> None:
        for tid, info in list(self.running.items()):
            if info["proc"].poll() is not None:
                del self.running[tid]
                self.finish(tid, info)

    def tick(self) -> bool:
        """One scheduling pass; returns True while there is still work (queued or running)."""
        self.reap()
        while len(self.running) < self.max_parallel and time.time() - self.last_start >= self.stagger:
            if not self.budget_left():
                break
            t = self.db.execute("SELECT * FROM tasks WHERE status='queued' ORDER BY priority DESC, id LIMIT 1").fetchone()
            if t is None:
                break
            self.start(t)
        queued = self.db.execute("SELECT COUNT(*) FROM tasks WHERE status='queued'").fetchone()[0]
        return bool(self.running) or bool(queued)

    def loop(self, once: bool) -> None:
        self.recover()
        while True:
            busy = self.tick()
            if once and (not busy or (not self.running and not self.budget_left())):
                return
            time.sleep(0.2 if once else 2)


# ---------------------------------------------------------------- CLI
def fmt(t: sqlite3.Row) -> str:
    return f"{t['id']:>4}  {t['status']:<9} p{t['priority']:<3} try {t['attempts']} step {t['step_idx']}  {t['slug']}"


def cmd_add(db, a) -> int:
    if not Path(a.task_file).is_file():
        print(f"task file not found: {a.task_file}", file=sys.stderr)
        return 2
    ladder = [s.strip() for s in a.ladder.split(",") if s.strip()]
    bad = [s for s in ladder if s not in ("best", "free", "ds-flash", "strong")]
    if not ladder or bad:
        print(f"bad ladder {a.ladder!r} (best, free, ds-flash, strong)", file=sys.stderr)
        return 2
    now = time.time()
    cur = db.execute(
        "INSERT INTO tasks (slug, task_file, scopes, public, priority, accept, ladder, created, updated) VALUES (?,?,?,?,?,?,?,?,?)",
        (a.slug, str(Path(a.task_file).resolve()), json.dumps(a.scope), int(a.public), a.priority, a.accept, json.dumps(ladder), now, now))
    db.commit()
    print(cur.lastrowid)
    return 0


def cmd_list(db, a) -> int:
    q, args = "SELECT * FROM tasks", ()
    if a.status:
        q, args = q + " WHERE status=?", (a.status,)
    for t in db.execute(q + " ORDER BY id", args):
        print(fmt(t))
    return 0


def get(db, tid: int):
    t = db.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    if t is None:
        print(f"no task {tid}", file=sys.stderr)
    return t


def cmd_show(db, a) -> int:
    t = get(db, a.id)
    if t is None:
        return 1
    for k in t.keys():
        print(f"{k}: {t[k]}")
    return 0


def cmd_cancel(db, a) -> int:
    t = get(db, a.id)
    if t is None:
        return 1
    if t["status"] in ("done", "failed", "cancelled"):
        print(f"task already {t['status']}", file=sys.stderr)
        return 1
    if t["status"] == "running" and alive(t["pid"]):
        try:
            os.killpg(t["pid"], signal.SIGTERM)
        except OSError:
            pass
    update(db, a.id, status="cancelled", pid=None)
    notify(f"تسک {t['slug']}: لغو شد")
    return 0


def cmd_retry(db, a) -> int:
    t = get(db, a.id)
    if t is None:
        return 1
    if t["status"] not in ("failed", "cancelled", "done"):
        print(f"task is {t['status']}; cancel it first", file=sys.stderr)
        return 1
    update(db, a.id, status="queued", step_idx=0, attempts=0, pid=None, reason=None, work_file=None)
    return 0


def cmd_run(db, a) -> int:
    Worker(db, a.max_parallel, a.stagger).loop(a.once)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("add")
    s.add_argument("--slug", required=True)
    s.add_argument("--task-file", required=True)
    s.add_argument("--scope", action="append", default=[])
    s.add_argument("--public", action="store_true")
    s.add_argument("--priority", type=int, default=0)
    s.add_argument("--accept")
    s.add_argument("--ladder", default=DEFAULT_LADDER)
    s = sub.add_parser("list")
    s.add_argument("--status", choices=STATES)
    for name in ("show", "cancel", "retry"):
        sub.add_parser(name).add_argument("id", type=int)
    s = sub.add_parser("run")
    s.add_argument("--max-parallel", type=int, default=3)
    s.add_argument("--stagger", type=float, default=15)
    s.add_argument("--once", action="store_true")
    return p


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    db = connect()
    return {"add": cmd_add, "list": cmd_list, "show": cmd_show, "cancel": cmd_cancel,
            "retry": cmd_retry, "run": cmd_run}[a.cmd](db, a)


if __name__ == "__main__":
    sys.exit(main())
