#!/usr/bin/env python3
"""Box status collector and static HTML page (work package J, observability). Stdlib only, no network service.

`box_status.py collect` gathers read-only facts about the Linux box (user systemd units, orch state, lane cost
against caps, disk/RAM/load, CI runners, tunnel, phone stack containers, backup freshness) and writes
`index.html` plus `status.json` atomically into one output directory. A user-level `python3 -m http.server`
unit serves that directory on loopback (or a LAN address chosen in the env file). The page is plain HTML with a
meta refresh: no JavaScript, no CDN, no external fonts.

Every collector is defensive: a failing source becomes {"state": "unknown", "error": ...}, never an exception,
and "unknown" never counts as a failure for the alert script. Nothing here writes outside the output directory,
nothing reads a secret, and no command changes system state.

Pure parse functions (parse_*, classify_*, sum_cost, render_html) take text or dicts so tests run offline.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HOME = Path(os.environ.get("HOME", "/"))
DEFAULT_OUT = HOME / ".local/share/roxira-status/www"
LANE_STATE = HOME / ".local/state/roxira-lane"
TUNNEL_URL = "http://127.0.0.1:4181/health/liveliness"
BACKUP_STAMP = "/var/lib/roxira/last-backup"
DATA_DISK = "/srv/data"
BOX_STATUS_BIN = "/usr/local/bin/box-status"

# (label, unit, kind) kind: service = long-running, oneshot = timer-driven service, timer
UNITS = [
    ("tunnel", "roxira-gateway-tunnel.service", "service"),
    ("orch", "roxira-orch.service", "oneshot"),
    ("orch timer", "roxira-orch.timer", "timer"),
    ("taskq", "roxira-lane-taskq.service", "oneshot"),
    ("taskq timer", "roxira-lane-taskq.timer", "timer"),
    ("bridge", "roxira-bridge.service", "oneshot"),
    ("bridge timer", "roxira-bridge.timer", "timer"),
    ("merge gate", "roxira-merge-gate.service", "oneshot"),
    ("merge gate timer", "roxira-merge-gate.timer", "timer"),
    ("direct-push check", "roxira-check-main-push.service", "oneshot"),
    ("mirror", "roxira-mirror.service", "oneshot"),
    ("gh export", "roxira-gh-export.service", "oneshot"),
    ("status collector", "roxira-status-collect.service", "oneshot"),
    ("status alert", "roxira-status-alert.service", "oneshot"),
]
SHOW_PROPS = ("LoadState", "ActiveState", "SubState", "Result", "ExecMainStatus", "UnitFileState",
              "ExecMainExitTimestamp", "InactiveEnterTimestamp", "ActiveEnterTimestamp", "LastTriggerUSec", "NextElapseUSecRealtime")


# ------------------------------------------------------------------ helpers
def run(cmd: list[str], timeout: float = 20, env: dict | None = None) -> tuple[int, str]:
    """(returncode, stdout). Never raises; a missing binary or a timeout is rc 127 / 124 with the reason."""
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False,
                             env={**os.environ, **(env or {})})
        return res.returncode, res.stdout
    except FileNotFoundError:
        return 127, ""
    except subprocess.TimeoutExpired:
        return 124, ""
    except OSError as exc:
        return 126, str(exc)


def unknown(why: str) -> dict:
    return {"state": "unknown", "error": str(why)[:200]}


def parse_ts(value) -> float | None:
    """ISO-8601 (Z or offset) -> epoch seconds; None when it is not a timestamp."""
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).timestamp()


def age_text(seconds: float | None) -> str:
    if seconds is None:
        return "never"
    s = int(max(seconds, 0))
    if s < 90:
        return f"{s}s ago"
    if s < 5400:
        return f"{s // 60} min ago"
    if s < 172800:
        return f"{s // 3600} h ago"
    return f"{s // 86400} d ago"


def atomic_write(path: Path, text: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


# ------------------------------------------------------------------ systemd units
def parse_show(text: str) -> dict:
    """`systemctl show -p ...` output -> {Key: value}."""
    out = {}
    for line in text.splitlines():
        k, sep, v = line.partition("=")
        if sep:
            out[k.strip()] = v.strip()
    return out


def classify_unit(props: dict, kind: str) -> dict:
    """Unit properties -> {"state": ok|failed|neutral|unknown, "text": ..., "last_run", "result", "next"}.

    neutral = not installed or installed but disabled/never started (orch and taskq today): never a failure.
    """
    if not props:
        return {"state": "unknown", "text": "no data"}
    load, active = props.get("LoadState", ""), props.get("ActiveState", "")
    result, sub = props.get("Result", ""), props.get("SubState", "")
    last = props.get("ExecMainExitTimestamp") or props.get("InactiveEnterTimestamp") or props.get("ActiveEnterTimestamp") or ""
    last = "" if last in ("", "n/a", "0") else last
    info = {"last_run": last, "result": result, "next": props.get("NextElapseUSecRealtime", "") if kind == "timer" else "",
            "exit_status": props.get("ExecMainStatus", ""), "unit_file": props.get("UnitFileState", "")}
    if load == "not-found":
        return {**info, "state": "neutral", "text": "not installed"}
    if active == "failed" or (kind != "timer" and result not in ("", "success") and active != "active"):
        why = result if result not in ("", "success") else sub
        return {**info, "state": "failed", "text": f"failed ({why})"}
    if kind == "service":
        if active == "active":
            return {**info, "state": "ok", "text": f"running ({sub})"}
        return {**info, "state": "failed" if active in ("inactive", "deactivating") else "unknown", "text": f"{active} ({sub})"}
    if kind == "timer":
        if active == "active":
            return {**info, "state": "ok", "text": "waiting for next run"}
        return {**info, "state": "neutral", "text": f"{active}, {info['unit_file'] or 'disabled'}"}
    # oneshot service: inactive + success is the normal resting state
    if not last:
        return {**info, "state": "neutral", "text": "never ran"}
    return {**info, "state": "ok", "text": f"last run ok (exit {info['exit_status'] or '0'})"}


def collect_units(runner=run) -> dict:
    out = {}
    for label, unit, kind in UNITS:
        rc, text = runner(["systemctl", "--user", "show", unit, "--no-pager", "-p", ",".join(SHOW_PROPS)], 15)
        if rc != 0:
            out[unit] = {"label": label, "kind": kind, **unknown(f"systemctl rc {rc}")}
            continue
        out[unit] = {"label": label, "kind": kind, **classify_unit(parse_show(text), kind)}
    return out


# ------------------------------------------------------------------ orch (read only)
def parse_tick_log(text: str) -> dict:
    """Last orch tick from journal text: mode, WOULD CLAIM lines, skip lines. Empty dict when no tick is in it."""
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if "roxira-orch tick" in line:
            start = i
    if start is None:
        return {}
    tick = lines[start:]
    return {"mode": "apply" if "APPLY" in tick[0] else "dry-run",
            "claims": [re.sub(r"\s+", " ", x.strip())[:200] for x in tick if "WOULD CLAIM" in x][:5],
            "skips": [x.strip()[:160] for x in tick if x.strip().startswith("skip ")][:8],
            "nothing": any("nothing to claim" in x for x in tick)}


def collect_orch(env: dict, now: float, runner=run) -> dict:
    agents = Path(env.get("ROXIRA_AGENTS_HOME") or LANE_STATE)
    home = Path(env.get("ORCH_HOME") or agents / "orch")
    if not home.exists():
        return {"state": "neutral", "text": "not installed (no orch state directory yet)"}
    out = {"state": "ok", "home": "orch", "kill": (Path(env.get("ORCH_KILL_FILE") or home / "KILL")).exists(),
           "jobs": [], "breakers": [], "cooldowns": []}
    db_path = home / "orch.db"
    if db_path.exists():
        try:
            db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
            db.row_factory = sqlite3.Row
            out["jobs"] = [dict(r) for r in db.execute(
                "SELECT issue, lane, status, pr, updated FROM jobs ORDER BY updated DESC LIMIT 8")]
            out["breakers"] = [{"lane": r["lane"], "fails": r["fails"], "open_until": r["open_until"],
                                "open": r["open_until"] > now} for r in db.execute("SELECT * FROM breaker")]
            out["cooldowns"] = [{"provider": r["provider"], "until": r["until"]} for r in db.execute(
                "SELECT * FROM cooldowns WHERE until>?", (now,))]
            db.close()
        except sqlite3.Error as exc:
            out.update(unknown(f"orch.db: {exc}"))
    out["last_cycle"] = max([j["updated"] for j in out["jobs"]], default=None)
    # What the next tick would claim: the service's own dry-run output in the user journal (no orch call here).
    rc, text = runner(["journalctl", "--user", "-u", "roxira-orch.service", "-n", "120", "--no-pager", "-o", "cat"], 15)
    out["last_tick"] = parse_tick_log(text) if rc == 0 else {}
    return out


# ------------------------------------------------------------------ cost against caps
def _dec(value) -> float:
    try:
        v = float(value if value is not None else 0)
    except (TypeError, ValueError):
        return 0.0
    return v if v == v and v not in (float("inf"),) and v > 0 else 0.0


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    try:
        with open(path, encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if isinstance(rec, dict):
                    rows.append(rec)
    except OSError:
        pass
    return rows


def sum_cost(rows: list[dict], now: float, days: int = 7) -> dict:
    """{"days": {YYYY-MM-DD: {"usd", "attempts"}}, "today": {lane: {"usd", "attempts"}}}.

    Same rules as lane-run --budget: UTC day, cost_usd parsed from its string, skipped/refused/over_budget
    rows are not attempts. Rows without a lane count under "default".
    """
    today = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d")
    oldest = now - days * 86400
    per_day: dict = {}
    per_lane: dict = {}
    for r in rows:
        ts = parse_ts(r.get("ts"))
        if ts is None or ts < oldest or r.get("status") in ("skipped_bot", "refused", "over_budget"):
            continue
        day = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")
        usd = _dec(r.get("cost_usd"))
        d = per_day.setdefault(day, {"usd": 0.0, "attempts": 0})
        d["usd"] += usd
        d["attempts"] += 1
        if day == today:
            lane = (str(r.get("lane") or "").strip().lower()) or "default"
            lv = per_lane.setdefault(lane, {"usd": 0.0, "attempts": 0})
            lv["usd"] += usd
            lv["attempts"] += 1
    return {"days": dict(sorted(per_day.items())), "today": per_lane}


def lane_caps(cfg: dict, lane: str) -> dict:
    lanes = cfg.get("lanes") if isinstance(cfg.get("lanes"), dict) else {}
    src = lanes.get(lane) or cfg.get("default") or {}
    return {"usd": _dec(src.get("usd_per_day")), "attempts": _dec(src.get("attempts_per_day"))}


def build_cost(lane_run_rows, orch_rows, cfg: dict, now: float, daily_cap: float) -> dict:
    """Per-lane today vs caps, plus daily totals. When both logs hold the same run (orch runs through lane-run)
    the larger figure per lane wins, so one run is never counted twice."""
    a, b = sum_cost(lane_run_rows, now), sum_cost(orch_rows, now)
    lanes = {}
    for lane in sorted(set(a["today"]) | set(b["today"]) | {k for k in (cfg.get("lanes") or {}) if k != "smoke"}):
        la, lb = a["today"].get(lane, {"usd": 0.0, "attempts": 0}), b["today"].get(lane, {"usd": 0.0, "attempts": 0})
        usd, att = max(la["usd"], lb["usd"]), max(la["attempts"], lb["attempts"])
        caps = lane_caps(cfg, lane)
        lanes[lane] = {"usd": round(usd, 6), "attempts": att, "cap_usd": caps["usd"], "cap_attempts": caps["attempts"],
                       "usd_ratio": (usd / caps["usd"]) if caps["usd"] else None}
    total = sum(v["usd"] for v in lanes.values())
    days = {}
    for day in sorted(set(a["days"]) | set(b["days"])):
        da, db = a["days"].get(day, {"usd": 0.0, "attempts": 0}), b["days"].get(day, {"usd": 0.0, "attempts": 0})
        days[day] = {"usd": round(max(da["usd"], db["usd"]), 6), "attempts": max(da["attempts"], db["attempts"])}
    return {"lanes": lanes, "total_usd": round(total, 6), "daily_cap_usd": daily_cap,
            "total_ratio": (total / daily_cap) if daily_cap else None, "days": days}


def collect_cost(env: dict, now: float) -> dict:
    logs = Path(env.get("LANE_LOG_DIR") or LANE_STATE / "logs")
    agents = Path(env.get("ROXIRA_AGENTS_HOME") or LANE_STATE)
    orch_log = Path(env.get("ORCH_HOME") or agents / "orch") / "orch_cost.jsonl"
    here = Path(__file__).resolve().parent
    budgets = Path(env.get("LANE_BUDGETS") or here / "lane_budgets.box.json")
    if not budgets.exists():  # repo layout: the caps file lives in the lane runner pack
        budgets = here.parent / "lane_runner" / "lane_budgets.box.json"
    try:
        cfg = json.loads(budgets.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cfg = {}
    try:
        cap = float(env.get("STATUS_DAILY_CAP_USD") or (cfg.get("global") or {}).get("usd_per_day") or 1.0)
    except ValueError:
        cap = 1.0
    try:
        return build_cost(read_jsonl(logs / "lane-run.jsonl"), read_jsonl(orch_log), cfg, now, cap)
    except Exception as exc:  # pragma: no cover - defensive
        return unknown(f"cost: {exc}")


# ------------------------------------------------------------------ system
def parse_meminfo(text: str) -> dict:
    kv = {}
    for line in text.splitlines():
        m = re.match(r"(\w+):\s+(\d+)\s*kB", line)
        if m:
            kv[m.group(1)] = int(m.group(2)) * 1024
    total, avail = kv.get("MemTotal", 0), kv.get("MemAvailable", 0)
    swap_t, swap_f = kv.get("SwapTotal", 0), kv.get("SwapFree", 0)
    return {"total": total, "available": avail, "used_pct": round(100 * (total - avail) / total, 1) if total else None,
            "swap_used_pct": round(100 * (swap_t - swap_f) / swap_t, 1) if swap_t else 0.0}


def parse_loadavg(text: str) -> list[float]:
    try:
        return [float(x) for x in text.split()[:3]]
    except ValueError:
        return []


def disk_entry(path: str) -> dict:
    try:
        u = shutil.disk_usage(path)
    except OSError as exc:
        return {"path": path, **unknown(exc)}
    return {"path": path, "state": "ok", "total": u.total, "used": u.used, "free": u.free,
            "used_pct": round(100 * u.used / u.total, 1) if u.total else None}


def read_text(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def collect_system(env: dict) -> dict:
    mem = parse_meminfo(read_text("/proc/meminfo"))
    load = parse_loadavg(read_text("/proc/loadavg"))
    up = read_text("/proc/uptime").split()
    return {"disks": [disk_entry("/"), disk_entry(env.get("STATUS_DATA_DISK") or DATA_DISK)], "mem": mem, "load": load,
            "cpus": os.cpu_count() or 0, "uptime_s": float(up[0]) if up else None}


# ------------------------------------------------------------------ CI runners
def parse_runners(payload) -> list[dict]:
    """`GET /actions/runners` JSON -> [{name, status, busy, labels}]. Anything malformed -> []."""
    items = payload.get("runners") if isinstance(payload, dict) else None
    out = []
    for r in items or []:
        if isinstance(r, dict):
            out.append({"name": str(r.get("name", "?")), "status": str(r.get("status", "?")), "busy": bool(r.get("busy")),
                        "labels": [str(x.get("name")) for x in r.get("labels", []) if isinstance(x, dict)][:8]})
    return out


def parse_box_status(text: str) -> dict:
    """Lines `name: value` of `box-status` (services section) -> {xray, docker, runner}. Missing -> not in dict."""
    out = {}
    for line in text.splitlines():
        m = re.match(r"^(xray|docker|runner):\s*(\S+)", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def collect_runners(env: dict, runner=run) -> dict:
    out = {"registered": unknown("not queried"), "legacy": unknown("box-status unavailable")}
    repo = env.get("STATUS_REPO") or ""
    if not repo:
        rc, text = runner(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], 30, {"GH_PROMPT_DISABLED": "1"})
        repo = text.strip() if rc == 0 else ""
    if repo:
        rc, text = runner(["gh", "api", f"repos/{repo}/actions/runners"], 30, {"GH_PROMPT_DISABLED": "1"})
        if rc == 0:
            try:
                out["registered"] = {"state": "ok", "runners": parse_runners(json.loads(text))}
            except ValueError:
                out["registered"] = unknown("bad JSON from gh api")
        else:
            out["registered"] = unknown(f"gh api rc {rc}")
    else:
        out["registered"] = unknown("repo not known (set STATUS_REPO)")
    rc, text = runner(["sudo", "-n", BOX_STATUS_BIN], 30)
    parsed = parse_box_status(text) if rc == 0 else {}
    if "runner" in parsed:  # the legacy service is a unit of the runner user, so only box-status can see it
        out["legacy"] = {"state": "ok", "runner_service": parsed["runner"], "xray": parsed.get("xray"), "docker": parsed.get("docker")}
    return out


# ------------------------------------------------------------------ tunnel, containers, backups
def collect_tunnel(timeout: float = 3.0) -> dict:
    """Loopback liveliness. A ProxyHandler({}) keeps the probe off the box proxy (no false 'down')."""
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(TUNNEL_URL, timeout=timeout) as resp:
            body = resp.read(200).decode("utf-8", "replace")
        ok = "alive" in body.lower()
        return {"state": "ok" if ok else "failed", "text": "alive" if ok else "unexpected reply"}
    except Exception as exc:  # connection refused, timeout, bad status: all mean "no tunnel"
        return {"state": "failed", "text": f"no answer ({type(exc).__name__})"}


def parse_docker_ps(text: str) -> list[dict]:
    """`docker ps -a --format '{{.Names}}\\t{{.Status}}'` -> [{name, state: ok|failed|neutral, status}]."""
    out = []
    for line in text.splitlines():
        name, _, status = line.partition("\t")
        if not name.strip():
            continue
        st = status.strip()
        if "unhealthy" in st or st.startswith(("Exited", "Dead", "Restarting")):
            state = "failed"
        elif st.startswith("Up"):
            state = "ok"
        else:
            state = "neutral"
        out.append({"name": name.strip(), "state": state, "status": st[:60]})
    return out


def collect_containers(runner=run) -> dict:
    rc, text = runner(["docker", "ps", "-a", "--format", "{{.Names}}\t{{.Status}}"], 20)
    if rc != 0:
        return unknown(f"docker ps rc {rc}")
    return {"state": "ok", "containers": parse_docker_ps(text)}


def parse_backup_stamp(text: str) -> float | None:
    """First token of /var/lib/roxira/last-backup (`<ISO time> OK ...`) -> epoch; None if absent or not OK."""
    parts = text.strip().split()
    if len(parts) >= 2 and parts[1] == "OK":
        return parse_ts(parts[0])
    return None


def collect_backups(env: dict, now: float) -> dict:
    items = []
    for label, path in (("box backup (restic)", env.get("STATUS_BACKUP_STAMP") or BACKUP_STAMP),
                        ("git mirror", str(HOME / ".local/state/roxira-box/mirror.last")),
                        ("github export", str(HOME / ".local/state/roxira-box/export.last"))):
        text = read_text(path)
        if label.startswith("box"):
            ts = parse_backup_stamp(text)
        else:  # "OK 2026-..." (mirror.last, export.last)
            bits = text.split()
            ts = parse_ts(bits[1]) if len(bits) >= 2 and bits[0] == "OK" else None
        items.append({"label": label, "present": bool(text.strip()), "ts": ts, "age_s": (now - ts) if ts else None})
    return {"state": "ok", "items": items}


# ------------------------------------------------------------------ collect + render
def collect(env: dict | None = None, now: float | None = None, runner=run) -> dict:
    env = dict(os.environ if env is None else env)
    now = time.time() if now is None else now
    snap = {"generated": now, "generated_iso": datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")}
    for key, fn in (("units", lambda: collect_units(runner)), ("orch", lambda: collect_orch(env, now, runner)),
                    ("cost", lambda: collect_cost(env, now)), ("system", lambda: collect_system(env)),
                    ("runners", lambda: collect_runners(env, runner)), ("tunnel", collect_tunnel),
                    ("containers", lambda: collect_containers(runner)), ("backups", lambda: collect_backups(env, now))):
        try:
            snap[key] = fn()
        except Exception as exc:  # one broken source must not blank the page
            snap[key] = unknown(f"{key}: {type(exc).__name__}: {exc}")
    return snap


CSS = """
:root{--bg:#f6f7f9;--fg:#1b1f24;--card:#fff;--line:#d9dde3;--ok:#1a7f37;--bad:#c62828;--mute:#6b7280;--warn:#9a6700}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e6e8eb;--card:#1c2026;--line:#2d333b;--ok:#3fb950;--bad:#f85149;--mute:#8b949e;--warn:#d29922}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:1080px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 8px}
.sub{color:var(--mute);margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:3px 8px 3px 0;vertical-align:top;font-size:14px}
th{color:var(--mute);font-weight:600}
.ok{color:var(--ok)}.failed{color:var(--bad);font-weight:600}.neutral,.unknown{color:var(--mute)}.warn{color:var(--warn);font-weight:600}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:currentColor}
.bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden;min-width:80px}.bar>i{display:block;height:100%;background:var(--ok)}
.bar.hot>i{background:var(--bad)}
code{font-size:13px}
"""


def e(x) -> str:
    return html.escape(str(x), quote=True)


def dot(state: str, text: str) -> str:
    cls = state if state in ("ok", "failed", "neutral", "unknown", "warn") else "unknown"
    return f'<span class="{cls}"><span class="dot"></span>{e(text)}</span>'


def bar(pct, hot_at: float = 85.0) -> str:
    if pct is None:
        return "n/a"
    p = max(0.0, min(float(pct), 100.0))
    return f'<div class="bar{" hot" if p >= hot_at else ""}"><i style="width:{p:.0f}%"></i></div>'


def gib(n) -> str:
    return f"{n / 2**30:.1f} GiB" if isinstance(n, (int, float)) else "?"


def fmt_ts(ts) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%m-%d %H:%M") + "Z" if isinstance(ts, (int, float)) else "-"


def render_html(snap: dict, refresh: int = 120) -> str:
    now = snap.get("generated", time.time())
    rows = []

    def sec(title: str, body: str) -> None:
        rows.append(f"<section><h2>{e(title)}</h2>{body}</section>")

    # units
    u = snap.get("units", {})
    t = "<table><tr><th>what</th><th>state</th><th>last run</th><th>next</th></tr>"
    for unit, v in u.items():
        t += (f"<tr><td>{e(v.get('label', unit))}<br><code>{e(unit)}</code></td><td>{dot(v.get('state', 'unknown'), v.get('text') or v.get('error', ''))}</td>"
              f"<td>{e(v.get('last_run') or '-')}</td><td>{e(v.get('next') or '-')}</td></tr>")
    sec("systemd user units and timers", t + "</table>")

    # orch
    o = snap.get("orch", {})
    if o.get("jobs") is None:
        sec("orch", f"<p>{dot(o.get('state', 'unknown'), o.get('text') or o.get('error', ''))}</p>")
    else:
        b = f"<p>kill switch: {dot('failed', 'SET') if o.get('kill') else dot('ok', 'off')}; last cycle: {e(age_text(now - o['last_cycle']) if o.get('last_cycle') else 'never')}</p>"
        for br in o.get("breakers", []):
            b += f"<p>breaker {e(br['lane'])}: {dot('failed', 'OPEN') if br['open'] else dot('ok', 'closed')} (fails {e(br['fails'])})</p>"
        tick = o.get("last_tick") or {}
        if tick:
            b += f"<p>last tick ({e(tick.get('mode'))}), would claim:</p><ul>" + "".join(f"<li><code>{e(c)}</code></li>" for c in tick.get("claims", [])) + "</ul>"
            if tick.get("nothing"):
                b += "<p class=\"neutral\">nothing to claim</p>"
        else:
            b += "<p class=\"neutral\">no tick output found in the user journal</p>"
        b += "<table><tr><th>issue</th><th>lane</th><th>status</th><th>PR</th></tr>" + "".join(
            f"<tr><td>#{e(j['issue'])}</td><td>{e(j['lane'])}</td><td>{e(j['status'])}</td><td>{e(j['pr'] or '-')}</td></tr>" for j in o.get("jobs", [])) + "</table>"
        sec("orch (read-only)", b)

    # cost
    c = snap.get("cost", {})
    if c.get("state") == "unknown":
        sec("gateway cost", f"<p>{dot('unknown', c.get('error', ''))}</p>")
    else:
        t = "<table><tr><th>lane</th><th>USD today</th><th>cap</th><th></th><th>attempts</th></tr>"
        for lane, v in c.get("lanes", {}).items():
            hot = v["usd_ratio"] is not None and v["usd_ratio"] >= 0.8
            t += (f"<tr><td>{e(lane)}</td><td class=\"{'warn' if hot else ''}\">{v['usd']:.4f}</td><td>{v['cap_usd']:g}</td>"
                  f"<td>{bar(100 * v['usd_ratio'] if v['usd_ratio'] is not None else None, 80)}</td><td>{v['attempts']}/{v['cap_attempts']:g}</td></tr>")
        t += f"<tr><th>total</th><th>{c.get('total_usd', 0):.4f}</th><th>{c.get('daily_cap_usd', 0):g}</th><th></th><th></th></tr></table>"
        t += "<p class=\"sub\">per day: " + ", ".join(f"{e(d)} ${v['usd']:.4f} ({v['attempts']} runs)" for d, v in list(c.get("days", {}).items())[-7:]) + "</p>"
        sec("gateway cost per lane vs cap (UTC day)", t)

    # system
    s = snap.get("system", {})
    t = "<table>"
    for d in s.get("disks", []):
        if d.get("state") == "unknown":
            t += f"<tr><td>{e(d['path'])}</td><td>{dot('unknown', d.get('error', ''))}</td></tr>"
        else:
            t += f"<tr><td>disk {e(d['path'])}</td><td>{d['used_pct']}% of {gib(d['total'])}, {gib(d['free'])} free</td><td>{bar(d['used_pct'])}</td></tr>"
    m = s.get("mem", {})
    t += f"<tr><td>RAM</td><td>{m.get('used_pct')}% used of {gib(m.get('total'))}</td><td>{bar(m.get('used_pct'), 90)}</td></tr>"
    t += f"<tr><td>load</td><td>{e(' '.join(str(x) for x in s.get('load', [])))} on {e(s.get('cpus'))} CPUs</td><td></td></tr></table>"
    sec("disk, RAM, load", t)

    # runners
    r = snap.get("runners", {})
    reg = r.get("registered", {})
    t = "<table>"
    if reg.get("state") == "ok":
        for x in reg.get("runners", []) or []:
            t += f"<tr><td>{e(x['name'])}</td><td>{dot('ok' if x['status'] == 'online' else 'failed', x['status'] + (' (busy)' if x['busy'] else ''))}</td></tr>"
        if not reg.get("runners"):
            t += f"<tr><td>registered</td><td>{dot('failed', 'none')}</td></tr>"
    else:
        t += f"<tr><td>registered</td><td>{dot('unknown', reg.get('error', ''))}</td></tr>"
    leg = r.get("legacy", {})
    t += (f"<tr><td>old actions-runner service</td><td>{dot('ok' if leg.get('runner_service') == 'active' else 'neutral', leg.get('runner_service'))}</td></tr>"
          if leg.get("state") == "ok" else f"<tr><td>old actions-runner service</td><td>{dot('unknown', leg.get('error', ''))}</td></tr>")
    sec("CI runners", t + "</table>")

    # tunnel + containers
    tu = snap.get("tunnel", {})
    body = f"<p>gateway tunnel (loopback): {dot(tu.get('state', 'unknown'), tu.get('text') or tu.get('error', ''))}</p>"
    ct = snap.get("containers", {})
    if ct.get("state") == "ok":
        body += "<table>" + "".join(f"<tr><td>{e(x['name'])}</td><td>{dot(x['state'], x['status'])}</td></tr>" for x in ct["containers"]) + "</table>"
    else:
        body += f"<p>phone stack containers: {dot('unknown', ct.get('error', ''))}</p>"
    sec("tunnel and phone stack", body)

    # backups
    t = "<table>"
    for x in snap.get("backups", {}).get("items", []):
        st = ("neutral", "none yet") if not x["present"] else (("unknown", "unreadable stamp") if x["ts"] is None else ("ok", age_text(x["age_s"])))
        t += f"<tr><td>{e(x['label'])}</td><td>{dot(*st)}</td><td>{e(fmt_ts(x['ts']))}</td></tr>"
    sec("backup freshness", t + "</table>")

    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<meta http-equiv="refresh" content="{int(refresh)}"><title>Box status</title><style>{CSS}</style></head><body><main>'
            f'<h1>Box status</h1><div class="sub">generated {e(snap.get("generated_iso", ""))} (UTC), refreshes every {int(refresh)} s. '
            f'Read-only page, no secrets.</div><div class="grid">{"".join(rows)}</div></main></body></html>\n')


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect", help="write index.html and status.json")
    c.add_argument("--out", default=os.environ.get("STATUS_OUT") or str(DEFAULT_OUT))
    c.add_argument("--print", action="store_true", help="print the JSON snapshot instead of writing files")
    a = p.parse_args(argv)
    snap = collect()
    if a.print:
        print(json.dumps(snap, indent=2, sort_keys=True, default=str))
        return 0
    out = Path(a.out)
    atomic_write(out / "status.json", json.dumps(snap, sort_keys=True, default=str))
    atomic_write(out / "index.html", render_html(snap))
    return 0


if __name__ == "__main__":
    sys.exit(main())
