#!/usr/bin/env python3
"""Per-lane daily budgets for taskq (FACTORY_V2 §6 item 5, docs/factory/COST_AND_REVIEW.md). Stdlib only.

Config: lane_budgets.json next to this file, or $TASKQ_BUDGETS. Caps per lane (missing/0 = no cap):
usd_per_day, tokens_per_day, attempts_per_day; `default` covers lanes not listed; `global.attempts_per_day`
replaces the old single TASKQ_MAX_ATTEMPTS_PER_DAY (the env var still wins when set).

Spend comes from the key-pool cost log (/var/log/roxira-keypool/requests.jsonl, cost_report.py format:
ts, model_group, prompt_tokens, completion_tokens, response_cost) plus taskq's own
$ROXIRA_AGENTS_HOME/logs/llm_calls.jsonl (llm_client.py). A record with a `lane` field counts for that
lane. Any other record counts only when its model_group matches `agent_model_groups` and it falls inside
an attempt window (start..end) from taskq; when several attempts run at once its cost is split evenly
between them. Gateway records outside every attempt (product traffic) are ignored. The day is the UTC day.
"""

from __future__ import annotations

import fnmatch
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_COST_LOG = "/var/log/roxira-keypool/requests.jsonl"
CAP_KEYS = ("usd_per_day", "tokens_per_day", "attempts_per_day")


def config_path() -> Path:
    return Path(os.environ.get("TASKQ_BUDGETS") or HERE / "lane_budgets.json")


def load_config(path: Path | None = None) -> dict:
    """Parsed config, or {} when the file is missing/unreadable (no lane caps then)."""
    try:
        data = json.loads(Path(path or config_path()).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def lane_name(lane: str | None) -> str:
    return (lane or "").strip().lower() or "default"


def caps(cfg: dict, lane: str | None) -> dict:
    lanes = cfg.get("lanes") if isinstance(cfg.get("lanes"), dict) else {}
    src = lanes.get(lane_name(lane)) or cfg.get("default") or {}
    out = {}
    for k in CAP_KEYS:
        try:
            v = float(src.get(k) or 0)
        except (TypeError, ValueError, AttributeError):
            v = 0.0
        out[k] = v if math.isfinite(v) and v > 0 else 0.0
    return out


def global_attempt_cap(cfg: dict) -> int:
    env = os.environ.get("TASKQ_MAX_ATTEMPTS_PER_DAY")
    if env:
        return int(env)
    try:
        return int((cfg.get("global") or {}).get("attempts_per_day") or 30)
    except (TypeError, ValueError, AttributeError):
        return 30


def cost_logs(cfg: dict) -> list[Path]:
    home = Path(os.environ.get("ROXIRA_AGENTS_HOME", "/var/lib/roxira-agents"))
    main = os.environ.get("KEYPOOL_COST_LOG") or cfg.get("cost_log") or DEFAULT_COST_LOG
    return [Path(main), home / "logs" / "llm_calls.jsonl"]


def day_start(now: float) -> float:
    d = datetime.fromtimestamp(now, timezone.utc)
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp()


def _ts(value) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).timestamp()


def _num(value) -> float:
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return v if math.isfinite(v) and v > 0 else 0.0


def read_records(paths: list[Path], since: float) -> list[tuple[float, dict]]:
    """(ts, record) pairs at or after `since`; unreadable files/lines are skipped."""
    out = []
    for p in paths:
        try:
            with open(p, encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    try:
                        rec = json.loads(line)
                    except ValueError:
                        continue
                    ts = _ts(rec.get("ts")) if isinstance(rec, dict) else None
                    if ts is not None and ts >= since:
                        out.append((ts, rec))
        except OSError:
            continue
    return out


def lane_spend(records: list[tuple[float, dict]], windows: list[tuple[str, float, float | None]],
               groups: list[str], now: float) -> dict[str, dict[str, float]]:
    """{lane: {"usd", "tokens"}} from cost records and attempt windows (lane, start, end-or-None)."""
    spend: dict[str, dict[str, float]] = {}

    def add(lane: str, usd: float, tokens: float) -> None:
        s = spend.setdefault(lane_name(lane), {"usd": 0.0, "tokens": 0.0})
        s["usd"] += usd
        s["tokens"] += tokens

    for ts, rec in records:
        usd = _num(rec.get("response_cost"))
        tokens = _num(rec.get("prompt_tokens")) + _num(rec.get("completion_tokens"))
        if rec.get("lane"):
            add(str(rec["lane"]), usd, tokens)
            continue
        group = str(rec.get("model_group") or "")
        if groups and not any(fnmatch.fnmatch(group, g) for g in groups):
            continue
        active = [lane for lane, start, end in windows if start <= ts <= (end if end is not None else now)]
        for lane in active:
            add(lane, usd / len(active), tokens / len(active))
    return spend


def task_spend(records: list[tuple[float, dict]], windows: list[tuple[int, float, float | None]],
               groups: list[str], now: float) -> dict[int, dict[str, float]]:
    """{task_id: {"usd", "tokens"}} (cost per task). A record tagged with `task` counts for that task; an
    untagged agent call (model_group in `groups`) is split evenly between the attempts running at its time;
    anything else (product traffic, lane-only records) is ignored."""
    spend: dict[int, dict[str, float]] = {}

    def add(task: int, usd: float, tokens: float) -> None:
        s = spend.setdefault(task, {"usd": 0.0, "tokens": 0.0})
        s["usd"] += usd
        s["tokens"] += tokens

    for ts, rec in records:
        usd = _num(rec.get("response_cost"))
        tokens = _num(rec.get("prompt_tokens")) + _num(rec.get("completion_tokens"))
        if rec.get("task") not in (None, ""):
            try:
                add(int(rec["task"]), usd, tokens)
            except (TypeError, ValueError):
                pass
            continue
        if rec.get("lane"):
            continue
        group = str(rec.get("model_group") or "")
        if groups and not any(fnmatch.fnmatch(group, g) for g in groups):
            continue
        active = sorted({tid for tid, start, end in windows if start <= ts <= (end if end is not None else now)})
        for tid in active:
            add(tid, usd / len(active), tokens / len(active))
    return spend


def over_budget(lane: str | None, used: dict[str, float], attempts: int, cfg: dict) -> str:
    """Reason text when the lane hit a cap today, else ''."""
    c = caps(cfg, lane)
    if c["attempts_per_day"] and attempts >= c["attempts_per_day"]:
        return f"{attempts} attempts >= cap {c['attempts_per_day']:g}"
    if c["usd_per_day"] and used.get("usd", 0.0) >= c["usd_per_day"]:
        return f"${used['usd']:.4f} >= cap ${c['usd_per_day']:g}"
    if c["tokens_per_day"] and used.get("tokens", 0.0) >= c["tokens_per_day"]:
        return f"{used['tokens']:.0f} tokens >= cap {c['tokens_per_day']:g}"
    return ""
