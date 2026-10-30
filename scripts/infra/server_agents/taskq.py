#!/usr/bin/env python3
"""Task queue + model escalation ladder over run_task.sh (factory milestone F2).

CLI over a SQLite DB (default /var/lib/roxira-agents/taskq.db); runs on the server as root.
  taskq.py add --slug S --task-file F [--scope P ...] [--public] [--priority N] [--accept CMD] [--ladder free,ds-flash,strong]
             [--lane be|fe|data|test|...]
  taskq.py list [--status S] | show ID | cancel ID | retry ID | budget | report [--days 7] [--fa|--json] | backfill [--dry-run]
  taskq.py run [--max-parallel 3] [--stagger 15] [--once]

Ladder steps: best = --gateway --public --tier best (gemini-best), free = run_task.sh --gateway --public (public tasks only), ds-flash = --model ds-flash,
strong = --model $TASKQ_STRONG_ALIAS (skipped when unset). A failed attempt moves to the next step with
the failure reason appended to a copy of the task file. Stdlib only.

Env: ROXIRA_AGENTS_HOME (state dir), TASKQ_DB, TASKQ_RUNNER (run_task.sh path), TASKQ_STRONG_ALIAS,
TASKQ_MAX_ATTEMPTS_PER_DAY (global cap; default from lane_budgets.json, else 30), TASKQ_NOTIFY=0 (no bot messages),
TASKQ_BUDGETS (per-lane daily $/token/attempt caps, lane_budget.py), TASKQ_REVIEW (default on, 0 disables: run review_hook.py on every
done task with a different model family; verdict lands in the `review` column), TASKQ_REVIEW_CMD (override).
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
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import lane_budget  # noqa: E402

NOTIFY = HERE.parent.parent / "ops" / "notify" / "notify.py"
STATES = ("queued", "running", "done", "failed", "cancelled")
DEFAULT_LADDER = "best,free,ds-flash,strong"
# Steps whose model calls go through the key-pool gateway, so the cost log sees them. ds-flash and strong call
# OpenRouter directly from run_task.sh: their paid spend is NOT metered (reported as `unmetered` attempts).
METERED_STEPS = ("best", "free")
# Author model per ladder step, so the reviewer can pick a different family (review_hook.py).
STEP_AUTHOR = {"best": "google/gemini-best", "free": "keypool/agent-strong-free",
               "ds-flash": "deepseek/deepseek-v4.1-flash"}


def openrouter_usage() -> float | None:
    """All-time USD spent on the agents OpenRouter key (GET /api/v1/key), or None without a key / on any error.
    ds-flash and strong attempts call OpenRouter directly, outside the gateway's cost log, so the difference of two
    readings around an attempt is their paid cost (split between attempts that overlapped)."""
    key = os.environ.get("OPENROUTER_API_KEY_AGENTS", "")
    if not key:
        return None
    try:
        req = urllib.request.Request("https://openrouter.ai/api/v1/key", headers={"Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return float(json.loads(resp.read().decode())["data"]["usage"])
    except Exception:  # noqa: BLE001
        return None


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
    # Additive migrations for DBs created before lanes (FACTORY_V2 §6.5).
    for table, col, decl in (("tasks", "lane", "TEXT NOT NULL DEFAULT ''"), ("tasks", "review", "TEXT"),
                             ("attempts", "lane", "TEXT NOT NULL DEFAULT ''"), ("attempts", "end_ts", "REAL"),
                             ("tasks", "cost_usd", "REAL NOT NULL DEFAULT 0"), ("tasks", "tokens", "INTEGER NOT NULL DEFAULT 0"),
                             ("tasks", "unmetered", "INTEGER NOT NULL DEFAULT 0"), ("tasks", "done_ts", "REAL"), ("attempts", "direct_usd", "REAL")):
        if col not in {r[1] for r in db.execute(f"PRAGMA table_info({table})")}:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
    db.commit()
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
        self.lane_told: dict[str, str] = {}  # lane -> UTC day it was reported over budget
        self.reviews: dict[int, subprocess.Popen] = {}

    def recover(self) -> None:
        for t in self.db.execute("SELECT * FROM tasks WHERE status='running'").fetchall():
            if not alive(t["pid"]):
                update(self.db, t["id"], status="queued", pid=None)
                notify(f"تسک {t['slug']}: پس از ری‌استارت دوباره در صف")

    def budget_left(self) -> bool:
        limit = lane_budget.global_attempt_cap(lane_budget.load_config())
        used = self.db.execute("SELECT COUNT(*) FROM attempts WHERE ts>=?", (time.time() - 86400,)).fetchone()[0]
        if used >= limit:
            if not self.budget_told:
                notify(f"صف تسک‌ها: سقف {limit} تلاش در ۲۴ ساعت پر شد؛ تلاش جدید شروع نمی‌شود")
                self.budget_told = True
            return False
        self.budget_told = False
        return True

    def lane_usage(self, cfg: dict, now: float | None = None) -> tuple[dict, dict]:
        """({lane: {usd, tokens}}, {lane: attempts}) for the current UTC day."""
        now = now or time.time()
        since = lane_budget.day_start(now)
        rows = self.db.execute("SELECT lane, ts, end_ts FROM attempts WHERE ts>=? OR end_ts IS NULL OR end_ts>=?",
                               (since, since)).fetchall()
        windows = [(r["lane"], r["ts"], r["end_ts"]) for r in rows]
        attempts: dict[str, int] = {}
        for r in rows:
            if r["ts"] >= since:
                attempts[lane_budget.lane_name(r["lane"])] = attempts.get(lane_budget.lane_name(r["lane"]), 0) + 1
        records = lane_budget.read_records(lane_budget.cost_logs(cfg), since)
        spend = lane_budget.lane_spend(records, windows, list(cfg.get("agent_model_groups") or []), now)
        return spend, attempts

    def record_cost(self, tid: int) -> None:
        """Cost per task: sum of every attempt (failed ladder steps and the review included), from the cost logs.

        A gateway call with a `task` tag (review_hook.py) goes to that task; any other agent call is split evenly
        between the attempts running at that moment (lane_budget.task_spend). Recomputed from scratch each time."""
        first = self.db.execute("SELECT MIN(ts) FROM attempts WHERE task_id=?", (tid,)).fetchone()[0]
        if first is None:
            return
        cfg = lane_budget.load_config()
        rows = self.db.execute("SELECT task_id, ts, end_ts FROM attempts WHERE lane!='review' AND (end_ts IS NULL OR end_ts>=?)", (first,)).fetchall()
        records = lane_budget.read_records(lane_budget.cost_logs(cfg), first)
        spend = lane_budget.task_spend(records, [(r["task_id"], r["ts"], r["end_ts"]) for r in rows],
                                       list(cfg.get("agent_model_groups") or []), time.time()).get(tid, {})
        unmetered = self.db.execute("SELECT COUNT(*) FROM attempts WHERE task_id=? AND step NOT IN (%s) AND lane!='review' "
                                    "AND direct_usd IS NULL" % ",".join("?" * len(METERED_STEPS)), (tid, *METERED_STEPS)).fetchone()[0]
        direct = self.db.execute("SELECT COALESCE(SUM(direct_usd), 0) FROM attempts WHERE task_id=?", (tid,)).fetchone()[0]
        update(self.db, tid, cost_usd=round(spend.get("usd", 0.0) + direct, 6), tokens=int(spend.get("tokens", 0)), unmetered=unmetered)

    def lane_blocked(self, lane: str, cfg: dict, usage: tuple[dict, dict]) -> str:
        """Reason when `lane` is over today's cap (told to the owner once per lane per day), else ''."""
        name = lane_budget.lane_name(lane)
        spend, attempts = usage
        reason = lane_budget.over_budget(name, spend.get(name, {}), attempts.get(name, 0), cfg)
        day = time.strftime("%Y-%m-%d", time.gmtime())
        if reason and self.lane_told.get(name) != day:
            notify(f"صف تسک‌ها: بودجهٔ روزانهٔ lane {name} پر شد ({reason})؛ تسک‌های این lane تا فردا شروع نمی‌شوند")
            self.lane_told[name] = day
        return reason

    def pick(self) -> sqlite3.Row | None:
        """Highest-priority queued task whose lane is within today's budget; other lanes keep running."""
        cfg = lane_budget.load_config()
        usage = None
        for t in self.db.execute("SELECT * FROM tasks WHERE status='queued' ORDER BY priority DESC, id").fetchall():
            if not cfg:
                return t
            usage = usage or self.lane_usage(cfg)
            if not self.lane_blocked(t["lane"], cfg, usage):
                return t
        return None

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
        cur = self.db.execute("INSERT INTO attempts (task_id, ts, step, lane) VALUES (?,?,?,?)", (t["id"], time.time(), name, t["lane"]))
        update(self.db, t["id"], status="running", pid=proc.pid, attempts=n, step_idx=idx, work_file=work)
        direct = name not in METERED_STEPS
        self.running[t["id"]] = {"proc": proc, "slug": slug, "offset": offset, "step": name, "alias": margs[-1],
                                 "attempt_id": cur.lastrowid, "peers": 1,
                                 "usage0": openrouter_usage() if direct else None, "direct": direct}
        if direct:  # overlapping direct attempts share the key's usage delta
            live = [i for i in self.running.values() if i["direct"]]
            for i in live:
                i["peers"] = max(i["peers"], len(live))
        self.last_start = time.time()
        notify(f"تسک {t['slug']}: شروع، مرحله {name} (تلاش {n})")

    def finish(self, tid: int, info: dict) -> None:
        self.db.execute("UPDATE attempts SET end_ts=? WHERE task_id=? AND end_ts IS NULL AND lane!='review'", (time.time(), tid))
        self.db.commit()
        if info.get("usage0") is not None and (u1 := openrouter_usage()) is not None:
            self.db.execute("UPDATE attempts SET direct_usd=? WHERE rowid=?",
                            (round(max(u1 - info["usage0"], 0.0) / info["peers"], 6), info["attempt_id"]))
            self.db.commit()
        self.record_cost(tid)
        t = self.db.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
        if t is None or t["status"] != "running":  # cancelled meanwhile
            return
        rec = read_result(info["offset"], info["slug"])
        ok, reason = judge(rec)
        if ok:
            patch = self.export_patch(t, rec)
            update(self.db, tid, status="done", done_ts=time.time(), pid=None, reason=None, branch=rec.get("branch"),
                   worktree=rec.get("worktree"), files=json.dumps(rec.get("files")),
                   checks=json.dumps(rec.get("checks")) if rec.get("checks") is not None else None, patch=patch)
            notify(f"تسک {t['slug']}: انجام شد، مرحله {info['step']}")
            if patch and os.environ.get("TASKQ_REVIEW", "1") != "0":
                self.start_review(t, patch, rec, info)
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

    def start_review(self, t: sqlite3.Row, patch: str, rec: dict, info: dict) -> None:
        """Reviewer automation: review_hook.py on the patch with a different model family (lane `review`)."""
        cfg = lane_budget.load_config()
        if cfg and self.lane_blocked("review", cfg, self.lane_usage(cfg)):
            update(self.db, t["id"], review="skipped: review lane over budget")
            return
        out = state_dir() / "reviews" / f"{t['id']}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        author = STEP_AUTHOR.get(info["step"]) or info.get("alias") or ""
        base = os.environ.get("TASKQ_REVIEW_CMD") or f"{sys.executable} {HERE / 'review_hook.py'}"
        cmd = [*base.split(), "--diff-file", patch, "--author-model", author, "--task-id", str(t["id"]), "--out", str(out)]
        checks = rec.get("checks") or rec.get("checks_path")
        if isinstance(checks, str):
            cmd += ["--checks-file", checks]
        if t["public"]:
            cmd.append("--public")
        with open(out.with_suffix(".log"), "wb") as logf:
            self.reviews[t["id"]] = subprocess.Popen(cmd, stdout=logf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                                     start_new_session=True)
        self.db.execute("INSERT INTO attempts (task_id, ts, step, lane) VALUES (?,?,?,?)", (t["id"], time.time(), "review", "review"))
        update(self.db, t["id"], review="running")

    def finish_review(self, tid: int, proc: subprocess.Popen) -> None:
        self.db.execute("UPDATE attempts SET end_ts=? WHERE task_id=? AND lane='review' AND end_ts IS NULL", (time.time(), tid))
        try:
            verdict = json.loads((state_dir() / "reviews" / f"{tid}.json").read_text()).get("verdict", "error")
        except (OSError, ValueError, AttributeError):
            verdict = "error"
        self.record_cost(tid)
        update(self.db, tid, review=f"{verdict} (exit {proc.returncode})")
        slug = self.db.execute("SELECT slug FROM tasks WHERE id=?", (tid,)).fetchone()["slug"]
        notify(f"تسک {slug}: بازبینی {verdict}")

    def reap(self) -> None:
        for tid, info in list(self.running.items()):
            if info["proc"].poll() is not None:
                del self.running[tid]
                self.finish(tid, info)
        for tid, proc in list(self.reviews.items()):
            if proc.poll() is not None:
                del self.reviews[tid]
                self.finish_review(tid, proc)

    def tick(self) -> bool:
        """One scheduling pass; returns True while there is still work (queued or running)."""
        self.reap()
        while len(self.running) < self.max_parallel and time.time() - self.last_start >= self.stagger:
            if not self.budget_left():
                break
            t = self.pick()
            if t is None:
                break
            self.start(t)
        queued = self.db.execute("SELECT COUNT(*) FROM tasks WHERE status='queued'").fetchone()[0]
        return bool(self.running) or bool(self.reviews) or bool(queued)

    def loop(self, once: bool) -> None:
        self.recover()
        while True:
            busy = self.tick()
            if once and (not busy or (not self.running and not self.reviews and (not self.budget_left() or self.pick() is None))):
                return
            time.sleep(0.2 if once else 2)


# ---------------------------------------------------------------- CLI
def fmt(t: sqlite3.Row) -> str:
    lane = t["lane"] or "-"
    return f"{t['id']:>4}  {t['status']:<9} p{t['priority']:<3} try {t['attempts']} step {t['step_idx']}  {lane:<6} {t['slug']}"


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
        "INSERT INTO tasks (slug, task_file, scopes, public, priority, accept, ladder, lane, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (a.slug, str(Path(a.task_file).resolve()), json.dumps(a.scope), int(a.public), a.priority, a.accept, json.dumps(ladder),
         (a.lane or "").strip().lower(), now, now))
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


def cmd_budget(db, a) -> int:
    """Today's (UTC) usage against each lane's caps."""
    cfg = lane_budget.load_config()
    spend, attempts = Worker(db, 1, 0).lane_usage(cfg)
    lanes = sorted(set((cfg.get("lanes") or {}).keys()) | set(spend) | set(attempts) | {"default"})
    print(f"config {lane_budget.config_path()}  global attempts cap {lane_budget.global_attempt_cap(cfg)}")
    for lane in lanes:
        c, s = lane_budget.caps(cfg, lane), spend.get(lane, {"usd": 0.0, "tokens": 0.0})
        over = lane_budget.over_budget(lane, s, attempts.get(lane, 0), cfg)
        print(f"{lane:<8} ${s['usd']:.4f}/{c['usd_per_day']:g}  tokens {s['tokens']:.0f}/{c['tokens_per_day']:g}  "
              f"attempts {attempts.get(lane, 0)}/{c['attempts_per_day']:g}  {'OVER: ' + over if over else 'ok'}")
    return 0


def weekly_summary(db: sqlite3.Connection, days: float = 7, now: float | None = None) -> dict:
    """Cost per accepted task over the last `days` days. Accepted = status done, counted by done_ts (older rows
    without done_ts fall back to `updated`). Cost of failed tasks and of failed ladder steps is kept apart so the
    headline number is what an accepted task really cost, and `wasted_usd` shows what failures cost."""
    since = (now or time.time()) - days * 86400
    rows = db.execute("SELECT * FROM tasks WHERE (status='done' AND COALESCE(done_ts, updated)>=?) "
                      "OR (status='failed' AND updated>=?)", (since, since)).fetchall()
    done = [r for r in rows if r["status"] == "done"]
    failed = [r for r in rows if r["status"] == "failed"]
    lanes: dict[str, dict] = {}
    for r in done:
        ln = lanes.setdefault(lane_budget.lane_name(r["lane"]), {"accepted": 0, "usd": 0.0})
        ln["accepted"] += 1
        ln["usd"] += r["cost_usd"]
    usd = sum(r["cost_usd"] for r in done)
    reviews: dict[str, int] = {}
    for r in done:
        v = (r["review"] or "none").split(" ")[0]
        reviews[v] = reviews.get(v, 0) + 1
    return {"days": days, "accepted": len(done), "failed": len(failed), "accepted_usd": round(usd, 6),
            "usd_per_accepted": round(usd / len(done), 6) if done else None,
            "wasted_usd": round(sum(r["cost_usd"] for r in failed), 6),
            "tokens": sum(r["tokens"] for r in done),
            "unmetered_attempts": sum(r["unmetered"] for r in done + failed),
            "attempts_per_accepted": round(sum(r["attempts"] for r in done) / len(done), 2) if done else None,
            "lanes": lanes, "reviews": reviews,
            "failed_reasons": [f"#{r['id']} {r['slug']}: {(r['reason'] or '')[:120]}" for r in failed][:5]}


def format_weekly_fa(w: dict) -> str:
    """Persian owner text for the weekly report (used by taskq.py report --fa and key_pool/cost_report.py --weekly-fa)."""
    fa = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
    n = lambda v: str(v).translate(fa)  # noqa: E731
    if not w["accepted"] and not w["failed"]:
        return f"🏭 کارخانهٔ ایجنت‌ها ({n(int(w['days']))} روز اخیر): هیچ تسکی پایان نیافت."
    per = "-" if w["usd_per_accepted"] is None else n(f"{w['usd_per_accepted']:.4f}")
    lines = [f"🏭 کارخانهٔ ایجنت‌ها ({n(int(w['days']))} روز اخیر)",
             f"تسک پذیرفته‌شده: {n(w['accepted'])}؛ ناموفق: {n(w['failed'])}",
             f"هزینهٔ هر تسک پذیرفته‌شده: {per} دلار (جمع {n(format(w['accepted_usd'], '.4f'))} دلار)؛ "
             f"هزینهٔ تسک‌های ناموفق: {n(format(w['wasted_usd'], '.4f'))} دلار"]
    if w["unmetered_attempts"]:
        lines.append(f"توجه: {n(w['unmetered_attempts'])} تلاش با مدل مستقیم OpenRouter در این عدد نیست")
    for lane, v in sorted(w["lanes"].items()):
        lines.append(f"• {lane}: {n(v['accepted'])} تسک، {n(format(v['usd'], '.4f'))} دلار")
    if w["reviews"]:
        lines.append("بازبینی: " + "، ".join(f"{k} {n(c)}" for k, c in sorted(w["reviews"].items())))
    return "\n".join(lines)


def cmd_report(db, a) -> int:
    w = weekly_summary(db, a.days)
    print(json.dumps(w, ensure_ascii=False, indent=2) if a.json else format_weekly_fa(w) if a.fa else format_weekly_en(w))
    return 0


def format_weekly_en(w: dict) -> str:
    per = "n/a" if w["usd_per_accepted"] is None else f"${w['usd_per_accepted']:.4f}"
    out = [f"taskq last {w['days']:g} days: {w['accepted']} accepted, {w['failed']} failed",
           f"cost per accepted task {per} (total ${w['accepted_usd']:.4f}, {w['tokens']} tokens, "
           f"{w['attempts_per_accepted']} attempts each); failed tasks cost ${w['wasted_usd']:.4f}"]
    if w["unmetered_attempts"]:
        out.append(f"{w['unmetered_attempts']} attempts used ds-flash/strong (direct OpenRouter): paid spend not in these numbers")
    out += [f"  {lane:<8} {v['accepted']} tasks ${v['usd']:.4f}" for lane, v in sorted(w["lanes"].items())]
    out.append("reviews: " + (", ".join(f"{k} {c}" for k, c in sorted(w["reviews"].items())) or "none"))
    return "\n".join(out + w["failed_reasons"])


def cmd_backfill(db, a) -> int:
    """Fill cost_usd/tokens/unmetered/done_ts for tasks that ran before cost tracking. Attempts without end_ts get an
    estimated window: from their start to the next attempt of the same task, or to the task's last update."""
    tasks = {r["id"]: r for r in db.execute("SELECT * FROM tasks")}
    att = db.execute("SELECT task_id, ts, end_ts, step FROM attempts WHERE lane!='review' ORDER BY task_id, ts").fetchall()
    wins = []
    for i, r in enumerate(att):
        nxt = next((b["ts"] for b in att[i + 1:] if b["task_id"] == r["task_id"]), None)
        end = r["end_ts"] or nxt or tasks[r["task_id"]]["updated"] if r["task_id"] in tasks else r["end_ts"]
        wins.append((r["task_id"], r["ts"], end))
    if not wins:
        print("no attempts to backfill")
        return 0
    cfg = lane_budget.load_config()
    spend = lane_budget.task_spend(lane_budget.read_records(lane_budget.cost_logs(cfg), min(w[1] for w in wins)), wins,
                                   list(cfg.get("agent_model_groups") or []), time.time())
    for tid, t in tasks.items():
        steps = [r["step"] for r in att if r["task_id"] == tid]
        sp = spend.get(tid, {})
        cols = dict(cost_usd=round(sp.get("usd", 0.0), 6), tokens=int(sp.get("tokens", 0)),
                    unmetered=sum(1 for st in steps if st not in METERED_STEPS))
        if t["status"] == "done" and not t["done_ts"]:
            cols["done_ts"] = t["updated"]
        if not a.dry_run:
            db.execute("UPDATE tasks SET %s WHERE id=?" % ", ".join(f"{k}=?" for k in cols), (*cols.values(), tid))
    db.commit()
    print(f"{'would update' if a.dry_run else 'updated'} {len(tasks)} tasks from {len(wins)} attempts")
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
    s.add_argument("--lane", default="", help="budget lane (lane_budgets.json): be, fe, data, test, ...")
    s = sub.add_parser("list")
    s.add_argument("--status", choices=STATES)
    sub.add_parser("budget")
    s = sub.add_parser("backfill", help="estimate cost for tasks that ran before cost tracking")
    s.add_argument("--dry-run", action="store_true")
    s = sub.add_parser("report")
    s.add_argument("--days", type=float, default=7)
    s.add_argument("--fa", action="store_true", help="Persian owner text")
    s.add_argument("--json", action="store_true")
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
            "retry": cmd_retry, "run": cmd_run, "budget": cmd_budget, "report": cmd_report, "backfill": cmd_backfill}[a.cmd](db, a)


if __name__ == "__main__":
    sys.exit(main())
