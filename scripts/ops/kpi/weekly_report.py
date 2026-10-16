#!/usr/bin/env python3
"""Weekly KPI report (factory milestone F7). Sent to the owner bot; see docs/ops/OBSERVABILITY.md.

Usage:
  weekly_report.py --dry-run     print the Persian report, send nothing
  weekly_report.py               send it through notify.py (silent no-op when the bot is not configured)
  options: --days N (default 7), --cost-log FILE, --taskq-db FILE, --deploy-state DIR

Sources, all read-only. Each section fails soft and says why it is missing:
  Umami API    UMAMI_API_URL (default http://127.0.0.1:3005/umami), UMAMI_API_TOKEN,
               UMAMI_WEBSITE_ROXIRA (roxira.ir), UMAMI_WEBSITE_GHAZI (ghazihoushmand.ir)
  LLM cost     $KEYPOOL_COST_LOG or /var/log/roxira-keypool/requests.jsonl (via cost_report.py)
  Agent queue  $TASKQ_DB or /var/lib/roxira-agents/taskq.db (opened with mode=ro)
  Deploys      $AUTODEPLOY_STATE_DIR or /root/deploy-state (*.json, *.jsonl)

Tokens, prompts and user data are never printed. Stdlib only, plus the two sibling modules.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "notify"))  # scripts/ops/notify/notify.py
sys.path.insert(0, str(HERE.parents[1] / "infra" / "key_pool"))  # scripts/infra/key_pool/cost_report.py

import cost_report  # noqa: E402
import notify  # noqa: E402

DEFAULT_UMAMI_API = "http://127.0.0.1:3005/umami"
DEFAULT_TASKQ_DB = "/var/lib/roxira-agents/taskq.db"
DEFAULT_DEPLOY_STATE = "/root/deploy-state"
TIMEOUT = 15
TOP_PAGES = 3
MAX_GROUPS = 8

# Website ids are per host: roxira.ir and ghazihoushmand.ir are separate Umami websites.
WEBSITES = (
    ("roxira.ir", "UMAMI_WEBSITE_ROXIRA"),
    ("ghazihoushmand.ir", "UMAMI_WEBSITE_GHAZI"),
)
# Event names must match src/lib/analytics/umami.ts (ANALYTICS_EVENTS).
FUNNEL_EVENTS = ("chat_started", "answer_shown", "signup_completed", "checkout_started", "payment_success")

Fetch = Callable[[str, dict[str, str], dict[str, Any]], Any]


# ---------------------------------------------------------------- helpers
def parse_time(value: Any) -> datetime | None:
    """ISO-8601 string (also +0000 offsets) or epoch seconds, as an aware UTC datetime."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            dt = datetime.strptime(text, "%Y-%m-%dT%H:%M:%S%z")
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _num(value: Any) -> float:
    if isinstance(value, dict):  # newer Umami returns {"value": n, "prev": m}
        value = value.get("value", 0)
    try:
        out = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return out if math.isfinite(out) else 0.0


def _cost(rec: dict[str, Any]) -> float:
    value = _num(rec.get("response_cost"))
    return value if value > 0 else 0.0


def _pct(part: float, whole: float) -> str:
    return f"{100.0 * part / whole:.0f}%" if whole else "n/a"


def _reason(exc: BaseException) -> str:
    """Short, secret-free reason for a failed section (never the URL, headers or body)."""
    if isinstance(exc, urllib.error.HTTPError):
        return f"HTTP {exc.code}"
    if isinstance(exc, urllib.error.URLError):
        return "network error"
    return type(exc).__name__


def http_get_json(url: str, headers: dict[str, str], params: dict[str, Any]) -> Any:
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{url}?{query}", headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8", "replace") or "null")


# ---------------------------------------------------------------- Umami
def umami_config(env: dict[str, str]) -> dict[str, Any]:
    token = (env.get("UMAMI_API_TOKEN") or "").strip()
    websites = {
        host: (env.get(var) or "").strip() for host, var in WEBSITES if (env.get(var) or "").strip()
    }
    if not token:
        return {"status": "not configured", "reason": "UMAMI_API_TOKEN unset"}
    if not websites:
        return {"status": "not configured", "reason": "no UMAMI_WEBSITE_* id set"}
    api = (env.get("UMAMI_API_URL") or DEFAULT_UMAMI_API).strip().rstrip("/")
    return {"status": "ok", "api": api, "token": token, "websites": websites}


def _pairs(rows: Any) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    if not isinstance(rows, list):
        return out
    for row in rows:
        if isinstance(row, dict) and row.get("x") is not None:
            out.append((str(row["x"]), int(_num(row.get("y")))))
    return out


def umami_site(api: str, token: str, website_id: str, start: datetime, end: datetime, fetch: Fetch) -> dict:
    # Umami accepts the API token as a bearer token (login token) or as an API key header; send both.
    headers = {"Authorization": f"Bearer {token}", "x-umami-api-key": token, "Accept": "application/json"}
    window = {"startAt": int(start.timestamp() * 1000), "endAt": int(end.timestamp() * 1000)}
    base = f"{api}/api/websites/{website_id}"
    stats = fetch(f"{base}/stats", headers, dict(window))
    stats = stats if isinstance(stats, dict) else {}
    pages = _pairs(fetch(f"{base}/metrics", headers, {**window, "type": "url", "limit": TOP_PAGES}))
    events = _pairs(fetch(f"{base}/metrics", headers, {**window, "type": "event", "limit": 50}))
    top_pages = [(path.split("?", 1)[0][:60], n) for path, n in pages[:TOP_PAGES]]
    return {
        "visitors": int(_num(stats.get("visitors"))),
        "pageviews": int(_num(stats.get("pageviews"))),
        "top_pages": top_pages,
        "events": dict(events),
    }


def umami_section(cfg: dict[str, Any], start: datetime, end: datetime, fetch: Fetch) -> dict[str, Any]:
    if cfg.get("status") != "ok":
        return cfg
    sites: dict[str, dict[str, Any]] = {}
    for host, website_id in cfg["websites"].items():
        try:
            sites[host] = umami_site(cfg["api"], cfg["token"], website_id, start, end, fetch)
        except Exception as exc:  # noqa: BLE001 - a broken site must not hide the others
            sites[host] = {"error": _reason(exc)}
    return {"status": "ok", "sites": sites}


# ---------------------------------------------------------------- LLM cost
def cost_section(path: str | None, days: int, end: datetime) -> dict[str, Any]:
    src = Path(path or cost_report.report_path())
    if not src.is_file():
        return {"status": "missing", "reason": f"no log at {src}"}
    start = end - timedelta(days=days)
    records = []
    for rec in cost_report.load_records(src, days=days, now=end):
        ts = parse_time(rec.get("ts"))
        if ts is not None and start <= ts < end:
            records.append(rec)
    per_day: dict[str, dict[str, Any]] = defaultdict(lambda: {"calls": 0, "ok": 0, "cost": 0.0})
    for rec in records:
        day = per_day[parse_time(rec.get("ts")).date().isoformat()]  # type: ignore[union-attr]
        day["calls"] += 1
        day["ok"] += 1 if rec.get("success") else 0
        day["cost"] += _cost(rec)
    return {
        "status": "ok",
        "agg": cost_report.aggregate(records),
        "per_day": [{"day": d, **per_day[d]} for d in sorted(per_day)],
    }


# ---------------------------------------------------------------- agent queue
def taskq_section(db_path: str | None, start: datetime, end: datetime) -> dict[str, Any]:
    path = Path(db_path or os.environ.get("TASKQ_DB") or DEFAULT_TASKQ_DB)
    if not path.is_file():
        return {"available": False, "reason": f"no database at {path}"}
    uri = "file:" + urllib.parse.quote(str(path.resolve()), safe="/") + "?mode=ro"
    try:
        con = sqlite3.connect(uri, uri=True, timeout=5)
    except sqlite3.Error as exc:
        return {"available": False, "reason": _reason(exc)}
    try:
        s, e = start.timestamp(), end.timestamp()
        done = con.execute(
            "SELECT COUNT(*) FROM tasks WHERE status='done' AND updated>=? AND updated<?", (s, e)
        ).fetchone()[0]
        failed = con.execute(
            "SELECT COUNT(*) FROM tasks WHERE status='failed' AND updated>=? AND updated<?", (s, e)
        ).fetchone()[0]
        avg = con.execute(
            "SELECT AVG(attempts) FROM tasks WHERE status IN ('done','failed') AND updated>=? AND updated<?",
            (s, e),
        ).fetchone()[0]
        attempts = con.execute(
            "SELECT COUNT(*) FROM attempts WHERE ts>=? AND ts<?", (s, e)
        ).fetchone()[0]
        live = dict(con.execute(
            "SELECT status, COUNT(*) FROM tasks WHERE status IN ('queued','running') GROUP BY status"
        ).fetchall())
    except sqlite3.Error as exc:
        return {"available": False, "reason": _reason(exc)}
    finally:
        con.close()
    return {
        "available": True,
        "done": int(done),
        "failed": int(failed),
        "attempts": int(attempts),
        "avg_attempts": float(avg or 0.0),
        "queued": int(live.get("queued", 0)),
        "running": int(live.get("running", 0)),
    }


# ---------------------------------------------------------------- deploys
def _read_state_records(path: Path) -> list[dict[str, Any]]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    items: list[Any] = []
    if path.suffix == ".jsonl":
        for line in text.splitlines():
            try:
                items.append(json.loads(line))
            except ValueError:
                continue
    else:
        try:
            loaded = json.loads(text)
        except ValueError:
            return []
        items = loaded if isinstance(loaded, list) else [loaded]
    return [item for item in items if isinstance(item, dict)]


def deploy_section(state_dir: str | None, start: datetime, end: datetime) -> dict[str, Any]:
    root = Path(state_dir or os.environ.get("AUTODEPLOY_STATE_DIR") or DEFAULT_DEPLOY_STATE)
    if not root.is_dir():
        return {"available": False, "reason": f"no state dir at {root}"}
    records: list[tuple[datetime, str]] = []
    read = 0
    for path in sorted(root.glob("*.json*")):
        for rec in _read_state_records(path):
            read += 1
            when = parse_time(rec.get("time") or rec.get("ts") or rec.get("finished_at"))
            if when is None:
                continue
            records.append((when, str(rec.get("result") or "unknown").lower()))
    in_window = [(w, r) for w, r in records if start <= w < end]
    ok_results = {"ok", "success", "done"}
    failed_results = {"failed", "fail", "error"}
    last = max(records, key=lambda item: item[0]) if records else None
    return {
        "available": True,
        "records_read": read,
        "total": len(in_window),
        "ok": sum(1 for _, r in in_window if r in ok_results),
        "failed": sum(1 for _, r in in_window if r in failed_results),
        "last_time": last[0].strftime("%Y-%m-%d %H:%M UTC") if last else None,
        "last_result": last[1] if last else None,
    }


# ---------------------------------------------------------------- report
def build_report(
    now: datetime,
    *,
    days: int = 7,
    env: dict[str, str] | None = None,
    cost_log: str | None = None,
    taskq_db: str | None = None,
    deploy_state: str | None = None,
    fetch: Fetch | None = None,
) -> dict[str, Any]:
    env = dict(os.environ) if env is None else env
    end = now.astimezone(timezone.utc)
    start = end - timedelta(days=days)
    return {
        "window": (start, end),
        "umami": umami_section(umami_config(env), start, end, fetch or http_get_json),
        "cost": cost_section(cost_log or env.get("KEYPOOL_COST_LOG"), days, end),
        "taskq": taskq_section(taskq_db, start, end),
        "deploys": deploy_section(deploy_state, start, end),
    }


def _render_umami(u: dict[str, Any]) -> list[str]:
    lines = ["", "تحلیل بازدید (Umami)"]
    if u.get("status") != "ok":
        return lines + [f"  در دسترس نیست: {u.get('reason', u.get('status'))}"]
    for host, site in u["sites"].items():
        if "error" in site:
            lines.append(f"  {host}: خطا ({site['error']})")
            continue
        ev = site["events"]
        visitors = site["visitors"]
        lines.append(f"  {host}: بازدیدکننده {visitors}، بازدید صفحه {site['pageviews']}")
        if site["top_pages"]:
            lines.append("    صفحات: " + "، ".join(f"{p} ({n})" for p, n in site["top_pages"]))
        chats = ev.get("chat_started", 0)
        answers = ev.get("answer_shown", 0)
        checkouts = ev.get("checkout_started", 0)
        paid = ev.get("payment_success", 0)
        signups = ev.get("signup_completed", 0)
        lines.append(f"    گفتگو: شروع {chats}، پاسخ نمایش‌داده‌شده {answers} ({_pct(answers, chats)})")
        lines.append(f"    ثبت‌نام/ورود: {signups} ({_pct(signups, visitors)} بازدیدکننده)")
        lines.append(f"    پرداخت: شروع {checkouts}، موفق {paid} ({_pct(paid, checkouts)})")
    return lines


def _render_cost(c: dict[str, Any]) -> list[str]:
    lines = ["", "هزینهٔ مدل‌های زبانی (key pool)"]
    if c.get("status") != "ok":
        return lines + [f"  در دسترس نیست: {c.get('reason', c.get('status'))}"]
    agg = c["agg"]
    per_ok = agg["total_cost"] / agg["success"] if agg["success"] else 0.0
    lines.append(
        f"  کل: {agg['calls']} تماس، {agg['success']} موفق ({_pct(agg['success'], agg['calls'])})، "
        f"${agg['total_cost']:.6f}، هر تماس موفق ${per_ok:.6f}"
    )
    for g in sorted(agg["groups"], key=lambda item: -item["total_cost"])[:MAX_GROUPS]:
        lines.append(
            f"  {g['group']}: {g['calls']} تماس، ${g['total_cost']:.6f}، ${g['cost_per_success']:.6f}/موفق"
        )
    for day in c["per_day"]:
        lines.append(f"  {day['day']}: {day['calls']} تماس، ${day['cost']:.6f}")
    return lines


def _render_taskq(t: dict[str, Any]) -> list[str]:
    lines = ["", "صف عامل‌ها (taskq)"]
    if not t.get("available"):
        return lines + [f"  در دسترس نیست: {t.get('reason')}"]
    lines.append(
        f"  انجام‌شده {t['done']}، ناموفق {t['failed']}، تلاش‌ها {t['attempts']}، "
        f"میانگین تلاش هر وظیفه {t['avg_attempts']:.1f}"
    )
    lines.append(f"  اکنون: در صف {t['queued']}، در حال اجرا {t['running']}")
    return lines


def _render_deploys(d: dict[str, Any]) -> list[str]:
    lines = ["", "استقرار (autodeploy)"]
    if not d.get("available"):
        return lines + [f"  در دسترس نیست: {d.get('reason')}"]
    lines.append(f"  در بازه: {d['total']} مورد، موفق {d['ok']}، ناموفق {d['failed']}")
    if d.get("last_time"):
        lines.append(f"  آخرین وضعیت: {d['last_time']} ({d['last_result']})")
    return lines


def render(report: dict[str, Any]) -> str:
    start, end = report["window"]
    lines = [f"گزارش هفتگی روکسیرا | {start:%Y-%m-%d} تا {end:%Y-%m-%d} (UTC)"]
    lines += _render_umami(report["umami"])
    lines += _render_cost(report["cost"])
    lines += _render_taskq(report["taskq"])
    lines += _render_deploys(report["deploys"])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Weekly KPI report (F7) for the owner bot.")
    ap.add_argument("--dry-run", action="store_true", help="print the report, send nothing")
    ap.add_argument("--days", type=int, default=7, help="window length in days (default 7)")
    ap.add_argument("--cost-log", default=None, help="requests.jsonl (default $KEYPOOL_COST_LOG)")
    ap.add_argument("--taskq-db", default=None, help="taskq.db (default $TASKQ_DB)")
    ap.add_argument("--deploy-state", default=None, help="state dir (default $AUTODEPLOY_STATE_DIR)")
    args = ap.parse_args(argv)
    if args.days < 1:
        ap.error("--days must be >= 1")
    report = build_report(
        datetime.now(timezone.utc),
        days=args.days,
        cost_log=args.cost_log,
        taskq_db=args.taskq_db,
        deploy_state=args.deploy_state,
    )
    text = render(report)
    if args.dry_run:
        print(text)
        return 0
    sent = notify.send(text)  # never raises; False when the bot is not configured
    print("weekly KPI report sent to the owner bot" if sent else "weekly KPI report not sent (bot not configured)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
