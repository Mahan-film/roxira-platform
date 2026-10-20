"""Host-side data sources for the owner admin console (admin_api.py).

Everything here reads files or small services that docker-compose.prod.yml makes available to the app
container (read-only bind mounts, see docs/ops/ADMIN_CONSOLE.md). The two exceptions that write are the
agent task queue (``taskq.py add`` through a fixed argv) and the marketing approve/reject state machine
(``mkt_store.Store.transition``); both go through the existing scripts, never through new SQL.

Paths are the SAME inside the container and on the host (bind mounts use identical source and target), so
a path that ``taskq.py`` stores in its database is valid for the host worker too. All of them can be
overridden with env vars (names below) for tests.

Nothing here returns a secret: prompts, tokens, headers of upstream calls and env values never leave.
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import json
import math
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import httpx

# ------------------------------------------------------------------ configuration


def _env(name: str, default: str) -> str:
    return (os.environ.get(name) or "").strip() or default


def repo_root() -> Path:
    # output_apps/generated_modules/smartjudge/admin_hostdata.py -> repo (or /app in the container)
    return Path(__file__).resolve().parents[3]


def cost_log_path() -> Path:
    return Path(_env("ADMIN_COST_LOG", "/var/log/roxira-keypool/requests.jsonl"))


def agents_home() -> Path:
    return Path(_env("ADMIN_AGENTS_HOME", "/var/lib/roxira-agents"))


def taskq_script() -> Path:
    return Path(_env("ADMIN_TASKQ_SCRIPT", str(repo_root() / "scripts" / "infra" / "server_agents" / "taskq.py")))


def marketing_home() -> Path:
    return Path(_env("ADMIN_MKT_HOME", "/var/lib/roxira-marketing"))


def marketing_script_dir() -> Path:
    return Path(_env("ADMIN_MKT_SCRIPT_DIR", str(repo_root() / "scripts" / "marketing")))


def bakeoff_dir() -> Path:
    return Path(_env("ADMIN_BAKEOFF_DIR", "/var/lib/roxira-eval/bakeoff"))


def deploy_state_dir() -> Path:
    return Path(_env("ADMIN_DEPLOY_STATE_DIR", "/root/deploy-state"))


def host_status_path() -> Path:
    return Path(_env("ADMIN_HOST_STATUS", "/var/lib/roxira-admin/host_status.json"))


def keypool_config_path() -> Path:
    return Path(_env("ADMIN_KEYPOOL_CONFIG", str(repo_root() / "config" / "key_pool.yaml")))


def docker_proxy_url() -> str:
    return _env("ADMIN_DOCKER_PROXY", "http://docker-socket-proxy:2375").rstrip("/")


def research_url() -> str:
    return _env("ADMIN_RESEARCH_URL", "http://roxira_research:8000").rstrip("/")


# Tehran has had no DST since 2022: a fixed +03:30 offset is exact and needs no tzdata in the image.
TEHRAN = dt.timezone(dt.timedelta(hours=3, minutes=30))


def window_starts(now: dt.datetime | None = None) -> dict[str, dt.datetime]:
    """UTC start of 'today' (Tehran midnight), the last 7 days and the last 30 days."""
    now = now or dt.datetime.now(dt.timezone.utc)
    local = now.astimezone(TEHRAN).replace(hour=0, minute=0, second=0, microsecond=0)
    return {"today": local.astimezone(dt.timezone.utc), "d7": now - dt.timedelta(days=7),
            "d30": now - dt.timedelta(days=30)}


# ------------------------------------------------------------------ LLM cost log
def _parse_ts(value: Any) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.timestamp()


def read_cost_records(path: Path, since_epoch: float, max_bytes: int = 256 * 1024 * 1024) -> list[dict]:
    """Records at or after ``since_epoch``. The log is append-only and chronological, so it is read from
    the end in blocks and reading stops at the first block that is older than the cutoff (the file can be
    200 MB). Unreadable lines are skipped. Returns [] when the file is absent."""
    try:
        size = path.stat().st_size
        fh = path.open("rb")
    except OSError:
        return []
    out: list[dict] = []
    with fh:
        pos, carry, read_total = size, b"", 0
        done = False
        while pos > 0 and not done and read_total < max_bytes:
            step = min(1024 * 1024, pos)
            pos -= step
            fh.seek(pos)
            block = fh.read(step) + carry
            read_total += step
            lines = block.split(b"\n")
            carry = lines[0] if pos > 0 else b""
            chunk = lines[1:] if pos > 0 else lines
            for raw in reversed(chunk):
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    rec = json.loads(raw)
                except ValueError:
                    continue
                ts = _parse_ts(rec.get("ts")) if isinstance(rec, dict) else None
                if ts is None:
                    continue
                if ts < since_epoch:
                    done = True
                    break
                rec["_ts"] = ts
                out.append(rec)
    out.reverse()
    return out


def _cost(rec: dict) -> float:
    try:
        value = float(rec.get("response_cost") or 0)
    except (TypeError, ValueError):
        return 0.0
    return value if math.isfinite(value) and value > 0 else 0.0


def _pct(values: list[float], pct: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return int(ordered[min(len(ordered) - 1, int(round(pct / 100 * (len(ordered) - 1))))])


def cost_summary(records: list[dict], windows: dict[str, float]) -> dict:
    """calls / failures / cost per window start (epoch) -> {name: {...}}."""
    out: dict[str, dict] = {}
    for name, start in windows.items():
        calls = [r for r in records if r["_ts"] >= start]
        failed = sum(1 for r in calls if not r.get("success", True))
        out[name] = {
            "calls": len(calls), "errors": failed,
            "error_rate": round(failed / len(calls), 4) if calls else 0.0,
            "cost_usd": round(sum(_cost(r) for r in calls), 6),
        }
    return out


def group_stats(records: list[dict], start_epoch: float, fallback_groups: set[str] | None = None) -> list[dict]:
    """Per model group: calls, errors, empty answers (success with 0 completion tokens), latency, cost."""
    by_group: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        if rec["_ts"] >= start_epoch:
            by_group[str(rec.get("model_group") or "?")].append(rec)
    rows = []
    for group, recs in by_group.items():
        lat = [float(r.get("latency_ms") or 0) for r in recs if r.get("success", True)]
        rows.append({
            "group": group, "calls": len(recs),
            "errors": sum(1 for r in recs if not r.get("success", True)),
            "empties": sum(1 for r in recs if r.get("success", True) and not int(r.get("completion_tokens") or 0)),
            "p50_ms": _pct(lat, 50), "p95_ms": _pct(lat, 95),
            "cost_usd": round(sum(_cost(r) for r in recs), 6),
            "is_fallback_target": group in (fallback_groups or set()),
        })
    return sorted(rows, key=lambda r: -r["calls"])


# ------------------------------------------------------------------ key pool config
def load_keypool_groups() -> dict[str, dict]:
    """group -> {description, fallback:[...]} from config/key_pool.yaml (read only, no keys in it)."""
    try:
        import yaml

        data = yaml.safe_load(keypool_config_path().read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001 - missing file / yaml: the tab says so
        return {}
    groups = data.get("groups") if isinstance(data, dict) else None
    if not isinstance(groups, dict):
        return {}
    return {str(name): {"description": str((g or {}).get("description", ""))[:200],
                        "fallback": [str(x) for x in (g or {}).get("fallback", []) or []]}
            for name, g in groups.items()}


def fallback_chain(group: str, groups: dict[str, dict], limit: int = 6) -> list[str]:
    chain: list[str] = []
    todo = list(groups.get(group, {}).get("fallback", []))
    while todo and len(chain) < limit:
        nxt = todo.pop(0)
        if nxt in chain or nxt == group:
            continue
        chain.append(nxt)
        todo.extend(groups.get(nxt, {}).get("fallback", []))
    return chain


# ------------------------------------------------------------------ bake-off reports
def latest_bakeoff(max_chars: int = 60_000) -> dict:
    root = bakeoff_dir()
    try:
        files = sorted((p for p in root.glob("*.md") if p.is_file()), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        files = []
    if not files:
        return {"available": False, "instructions": (
            "No bake-off report is visible to the app. Run it on the server: "
            "cd /opt/roxira_platform && python3 scripts/eval/model_bakeoff.py --judge "
            "(see docs/eval/README.md). The directory /var/lib/roxira-eval/bakeoff must be mounted read-only "
            "into the app container for the report to show here.")}
    latest = files[0]
    text = latest.read_text(encoding="utf-8", errors="replace")
    return {"available": True, "name": latest.name, "modified": dt.datetime.fromtimestamp(
        latest.stat().st_mtime, dt.timezone.utc).isoformat(), "truncated": len(text) > max_chars,
        "markdown": text[:max_chars], "others": [p.name for p in files[1:8]]}


# ------------------------------------------------------------------ Umami
_umami_cache: dict[str, tuple[float, Any]] = {}
_UMAMI_TTL = 300


def _num(value: Any) -> float:
    if isinstance(value, dict):
        value = value.get("value", 0)
    try:
        out = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return out if math.isfinite(out) else 0.0


def umami_visitors(windows: dict[str, dt.datetime], now: dt.datetime | None = None) -> dict:
    """Visitors / pageviews per window and site. Needs UMAMI_API_URL (default the umami container on
    roxira_net), a token or admin password and UMAMI_WEBSITE_ROXIRA / UMAMI_WEBSITE_GHAZI."""
    sites = {host: _env(var, "") for host, var in (("roxira.ir", "UMAMI_WEBSITE_ROXIRA"),
                                                    ("ghazihoushmand.ir", "UMAMI_WEBSITE_GHAZI"))}
    sites = {h: i for h, i in sites.items() if i}
    api = _env("UMAMI_API_URL", "http://roxira_umami:3000").rstrip("/")
    token = _env("UMAMI_API_TOKEN", "")
    password = _env("UMAMI_ADMIN_PASSWORD", "")
    if not sites or not (token or password):
        return {"status": "not configured",
                "reason": "set UMAMI_WEBSITE_ROXIRA/UMAMI_WEBSITE_GHAZI and UMAMI_API_TOKEN (or UMAMI_ADMIN_PASSWORD)"}
    cached = _umami_cache.get("all")
    if cached and cached[0] > time.time():
        return cached[1]
    now = now or dt.datetime.now(dt.timezone.utc)
    result: dict[str, Any] = {"status": "ok", "sites": {}}
    try:
        with httpx.Client(timeout=6.0) as client:
            if not token:
                login = client.post(f"{api}/api/auth/login", json={"username": "admin", "password": password})
                login.raise_for_status()
                token = str(login.json().get("token") or "")
            headers = {"Authorization": f"Bearer {token}", "x-umami-api-key": token, "Accept": "application/json"}
            for host, website_id in sites.items():
                per: dict[str, Any] = {}
                for name, start in windows.items():
                    resp = client.get(f"{api}/api/websites/{website_id}/stats", headers=headers, params={
                        "startAt": int(start.timestamp() * 1000), "endAt": int(now.timestamp() * 1000)})
                    resp.raise_for_status()
                    data = resp.json() if isinstance(resp.json(), dict) else {}
                    per[name] = {"visitors": int(_num(data.get("visitors"))),
                                 "pageviews": int(_num(data.get("pageviews")))}
                result["sites"][host] = per
    except Exception as exc:  # noqa: BLE001 - analytics must never break the dashboard
        result = {"status": "unreachable", "reason": type(exc).__name__}
    _umami_cache["all"] = (time.time() + _UMAMI_TTL, result)
    return result


# ------------------------------------------------------------------ system health
def containers() -> dict:
    """Container list from the host snapshot (scripts/ops/admin/host_snapshot.py writes `docker ps`).
    The app has no Docker API access at all, so no env vars of other containers can leak."""
    rows = host_status().get("containers") or []
    if not rows:
        return {"status": "unavailable", "reason": "no host snapshot", "containers": []}
    return {"status": "ok", "containers": rows}


def disk_usage(paths: list[str] | None = None) -> list[dict]:
    rows = []
    for p in paths or ["/", "/var/lib/roxira-agents", "/var/log/roxira-keypool"]:
        try:
            u = shutil.disk_usage(p)
        except OSError:
            continue
        rows.append({"path": p, "total_gb": round(u.total / 1e9, 1), "used_gb": round(u.used / 1e9, 1),
                     "free_gb": round(u.free / 1e9, 1), "used_pct": round(100 * u.used / u.total, 1) if u.total else 0})
    return rows


def last_deploy() -> dict:
    path = deploy_state_dir() / "autodeploy-last.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"available": False}
    keep = {k: data.get(k) for k in ("time", "target", "deployed_before", "migrated", "result")}
    keep["available"] = True
    try:
        failed = (deploy_state_dir() / "autodeploy-failed-shas").read_text(encoding="utf-8").split()
        keep["failed_shas"] = len(failed)
    except OSError:
        keep["failed_shas"] = None
    return keep


def host_status(max_age_s: int = 600) -> dict:
    """Timers / host numbers written by scripts/ops/admin/host_snapshot.py (a root timer on the host)."""
    try:
        data = json.loads(host_status_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"available": False, "hint": "scripts/ops/admin/install.sh --yes on the server (root timer)"}
    gen = _parse_ts(data.get("generated_at"))
    data["available"] = True
    data["stale"] = gen is None or (time.time() - gen) > max_age_s
    return data


# ------------------------------------------------------------------ agent task queue
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,39}$")
SCOPE_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./-]{0,119}$")
LADDER_STEPS = ("best", "free", "ds-flash", "strong")


def valid_scope(scope: str) -> bool:
    return bool(SCOPE_RE.match(scope)) and ".." not in scope.split("/") and not scope.startswith("/")


def queue_task(*, slug: str, task: str, scopes: list[str], ladder: list[str], public: bool, priority: int,
               actor: str) -> int:
    """Write the task file and run ``taskq.py add`` with a fixed argv (no shell, task text only in the file).
    Returns the new task id. Raises RuntimeError with a short reason on failure."""
    if not SLUG_RE.match(slug) or any(not valid_scope(s) for s in scopes) or not ladder \
            or any(s not in LADDER_STEPS for s in ladder):
        raise ValueError("bad task fields")  # the API validates first; this is the last line of defence
    script = taskq_script()
    if not script.is_file():
        raise RuntimeError("taskq.py is not mounted into the app container")
    inbox = agents_home() / "admin-tasks"
    inbox.mkdir(parents=True, exist_ok=True)
    path = inbox / f"{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}-{secrets.token_hex(3)}-{slug}.md"
    path.write_text(f"{task.strip()}\n\n<!-- queued from the admin console by {actor} -->\n", encoding="utf-8")
    argv = [sys.executable, str(script), "add", "--slug", slug, "--task-file", str(path),
            "--ladder", ",".join(ladder), "--priority", str(int(priority))]
    for scope in scopes:
        argv += ["--scope", scope]
    if public:
        argv.append("--public")
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "ROXIRA_AGENTS_HOME": str(agents_home()),
           "TASKQ_DB": str(agents_home() / "taskq.db"), "TASKQ_NOTIFY": "0", "PYTHONDONTWRITEBYTECODE": "1"}
    try:
        res = subprocess.run(argv, capture_output=True, text=True, timeout=30, env=env, shell=False, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"taskq add failed: {type(exc).__name__}") from exc
    out = res.stdout.strip().splitlines()
    if res.returncode != 0 or not out or not out[-1].isdigit():
        raise RuntimeError("taskq add failed: " + (res.stderr.strip()[-200:] or f"exit {res.returncode}"))
    return int(out[-1])


def recent_tasks(limit: int = 30) -> dict:
    db = agents_home() / "taskq.db"
    if not db.is_file():
        return {"available": False, "tasks": []}
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        with conn:
            rows = conn.execute(
                "SELECT id, slug, status, step_idx, attempts, public, priority, reason, branch, created, updated, "
                "ladder FROM tasks ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
            counts = {r[0]: r[1] for r in conn.execute("SELECT status, count(*) FROM tasks GROUP BY 1")}
        conn.close()
    except sqlite3.Error as exc:
        return {"available": False, "tasks": [], "reason": type(exc).__name__}
    tasks = [{**{k: r[k] for k in r.keys() if k not in ("reason", "ladder")},
              "reason": (r["reason"] or "")[:300], "ladder": r["ladder"]} for r in rows]
    return {"available": True, "tasks": tasks, "counts": counts}


# ------------------------------------------------------------------ marketing
_mkt_module = None


def _load_mkt_store():
    """Import scripts/marketing/mkt_store.py by path so the console uses the engine's own state machine."""
    global _mkt_module
    if _mkt_module is not None:
        return _mkt_module
    path = marketing_script_dir() / "mkt_store.py"
    if not path.is_file():
        raise RuntimeError("scripts/marketing is not mounted into the app container")
    spec = importlib.util.spec_from_file_location("admin_mkt_store", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load mkt_store")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _mkt_module = module
    return module


def _mkt_open():
    db = marketing_home() / "marketing.db"
    if not db.is_file():
        return None
    return _load_mkt_store().Store(str(db))


def _post_view(row: Any, caption_chars: int = 700) -> dict:
    try:
        tags = json.loads(row["hashtags"] or "[]")
    except ValueError:
        tags = []
    return {"id": row["id"], "brand": row["brand"], "platform": row["platform"], "campaign": row["campaign"],
            "status": row["status"], "caption": str(row["caption"])[:caption_chars], "hashtags": tags[:15],
            "link": row["link"], "scheduled_at": row["scheduled_at"], "updated": row["updated"],
            "error": row["error"], "external_id": row["external_id"], "has_image": bool(row["image_path"])}


def marketing_overview() -> dict:
    try:
        store = _mkt_open()
    except RuntimeError as exc:
        return {"available": False, "reason": str(exc), "drafts": [], "published": []}
    if store is None:
        return {"available": False, "reason": "marketing.db not found", "drafts": [], "published": []}
    try:
        drafts = [_post_view(r) for st in ("proposed", "draft") for r in store.list("posts", status=st)]
        published = [_post_view(r) for r in store.db.execute(
            "SELECT * FROM posts WHERE status='published' ORDER BY updated DESC LIMIT 30").fetchall()]
        counts = {r[0]: r[1] for r in store.db.execute("SELECT status, count(*) FROM posts GROUP BY 1")}
    finally:
        store.db.close()
    return {"available": True, "drafts": drafts, "published": published, "counts": counts,
            "paused": (marketing_home() / "PAUSE").exists()}


def marketing_decide(post_id: int, approve: bool) -> tuple[bool, str]:
    """Same transitions as mkt.py (draft -> proposed -> approved | rejected; proposed -> approved | rejected).
    Returns (changed, resulting_status_or_reason). A draft is first moved to 'proposed' (the owner is looking at
    it right now, which is exactly what 'propose' means), then approved."""
    store = _mkt_open()
    if store is None:
        return False, "marketing.db not found"
    try:
        row = store.get("posts", post_id)
        if row is None:
            return False, "not found"
        status = row["status"]
        if status not in ("draft", "proposed"):
            return False, f"already {status}"
        if approve:
            if status == "draft" and not store.transition("posts", post_id, "proposed"):
                return False, "transition refused"
            ok = store.transition("posts", post_id, "approved", only_from="proposed")
            return ok, "approved" if ok else "transition refused"
        ok = store.transition("posts", post_id, "rejected")
        return ok, "rejected" if ok else "transition refused"
    finally:
        store.db.close()


# ------------------------------------------------------------------ research service
async def run_research(query: str, report_type: str, max_sources: int, language: str = "fa") -> dict:
    """One call to roxira_research POST /research (blocks up to its own 900 s limit)."""
    headers = {}
    token = _env("RESEARCH_TOKEN", "")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = {"query": query, "report_type": report_type, "max_sources": max_sources, "language": language}
    async with httpx.AsyncClient(timeout=httpx.Timeout(930.0, connect=5.0)) as client:
        resp = await client.post(f"{research_url()}/research", json=payload, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"research service answered HTTP {resp.status_code}")
    data = resp.json()
    return {"report_markdown": str(data.get("report_markdown", "")),
            "sources": [{"url": str(s.get("url", "")), "title": str(s.get("title", ""))}
                        for s in data.get("sources", []) if isinstance(s, dict)],
            "duration_s": data.get("duration_s"), "costs": data.get("costs")}
