"""Redacted, JSONL-backed event records for Factory runs."""
import argparse
import hashlib
import json
import os
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

ALLOWED_STAGES = (
    "intake",
    "research",
    "approval",
    "plan",
    "task",
    "review",
    "preview",
    "deploy",
    "verify",
    "report",
)
_STATUSES = ("started", "success", "failure", "ok", "failed", "skipped")
_FORBIDDEN = {"prompt", "token", "api_key", "password", "text"}
_SECRET = re.compile(r"sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}")
def _safe(value):
    if isinstance(value, str):
        return not _SECRET.search(value)
    if isinstance(value, (int, float, bool)) or value is None:
        return True
    return isinstance(value, (list, tuple)) and all(_safe(item) for item in value)
def make_event(run_id: str, stage: str, status: str, *, now: str | None = None, **fields) -> dict:
    """Build a validated event without retaining sensitive content."""
    if stage not in ALLOWED_STAGES:
        raise ValueError(f"unknown stage: {stage}")
    if status not in _STATUSES:
        raise ValueError(f"unknown status: {status}")
    status = {"success": "ok", "failure": "failed"}.get(status, status)
    if any(
        key in _FORBIDDEN or _SECRET.search(key) or not _safe(value)
        for key, value in fields.items()
    ):
        raise ValueError("unsafe ledger field")
    ts = now or datetime.now(UTC).isoformat().replace("+00:00", "Z")
    if not all(_safe(value) for value in (run_id, stage, status, ts)):
        raise ValueError("unsafe ledger event")
    return {"run_id": run_id, "stage": stage, "status": status, "ts": ts, **fields}
def append_event(path, event: dict) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as file:
        file.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
def read_events(path) -> list[dict]:
    try:
        with Path(path).open(encoding="utf-8") as file:
            events = []
            for line in file:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if line.strip() and isinstance(event, dict):
                    events.append(event)
            return events
    except FileNotFoundError:
        return []
def summarize(events: list[dict]) -> dict:
    if not events:
        return {}
    stages, total = {}, 0
    for event in events:
        stages[event.get("stage")] = event.get("status")
        cost = event.get("cost_usd")
        if isinstance(cost, (int, float)) and not isinstance(cost, bool):
            total += cost
    return {"run_id": events[0].get("run_id"), "stages": stages,
            "failed": [stage for stage, status in stages.items()
                       if status in ("failed", "failure")],
            "total_cost_usd": total}

# --- Task-level ledger (counts/ids/statuses/hashes only; never prompts or contents) ---
TASK_KINDS = ("step", "park", "end")
_TASK_FIELDS = ("pr", "steps", "tokens_in", "tokens_out", "usd", "wall_s", "err_hash",
                "reason", "status")


def state_dir() -> Path:
    base = os.environ.get("ROXIRA_STATE_DIR") or str(Path.home() / ".local" / "state" / "roxira")
    return Path(base) / "runs"


def task_ledger_path() -> Path:
    return state_dir() / "tasks.jsonl"


def error_hash(signature: str) -> str:
    return hashlib.sha256(signature.encode("utf-8")).hexdigest()[:12]


def make_task_event(task_id: str, lane: str, model_role: str, kind: str, *,
                    now: str | None = None, **fields) -> dict:
    if kind not in TASK_KINDS:
        raise ValueError(f"unknown kind: {kind}")
    if any(key not in _TASK_FIELDS or not _safe(value) for key, value in fields.items()):
        raise ValueError("unsafe ledger field")
    ts = now or datetime.now(UTC).isoformat().replace("+00:00", "Z")
    head = (str(task_id), str(lane), str(model_role), ts)
    if not all(_safe(value) for value in head):
        raise ValueError("unsafe ledger event")
    return {"ts": ts, "task_id": head[0], "lane": head[1], "model_role": head[2],
            "kind": kind, **fields}


def append_task_event(task_id, lane, model_role, kind, *, path=None, now=None, **fields) -> dict:
    event = make_task_event(task_id, lane, model_role, kind, now=now, **fields)
    append_event(path or task_ledger_path(), event)
    return event


def _parse_ts(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def summarize_days(days: int = 7, *, path=None, now: datetime | None = None) -> dict:
    """USD per merged PR, steps and wall time per task, park rate over the last days."""
    cutoff = (now or datetime.now(UTC)) - timedelta(days=days)
    tasks: dict = {}
    for event in read_events(path or task_ledger_path()):
        ts = _parse_ts(event.get("ts"))
        if ts is None or ts < cutoff or "task_id" not in event:
            continue
        t = tasks.setdefault(event["task_id"], {"steps": 0, "usd": 0.0, "first": ts,
                                                "last": ts, "parked": False, "merged": False})
        t["first"], t["last"] = min(t["first"], ts), max(t["last"], ts)
        usd = event.get("usd")
        if isinstance(usd, (int, float)) and not isinstance(usd, bool):
            t["usd"] += usd
        if event.get("kind") == "step":
            t["steps"] += 1
        elif event.get("kind") == "park":
            t["parked"] = True
        elif event.get("kind") == "end" and event.get("status") == "merged":
            t["merged"] = True
    merged = sum(t["merged"] for t in tasks.values())
    total = sum(t["usd"] for t in tasks.values())
    parked = sum(t["parked"] for t in tasks.values())
    return {
        "days": days, "tasks": len(tasks), "merged_prs": merged, "total_usd": round(total, 4),
        "usd_per_merged_pr": round(total / merged, 4) if merged else None,
        "park_rate": round(parked / len(tasks), 4) if tasks else 0.0,
        "per_task": {k: {"steps": t["steps"],
                         "wall_s": int((t["last"] - t["first"]).total_seconds()),
                         "usd": round(t["usd"], 4)} for k, t in tasks.items()},
    }


def main() -> int:
    """Append a validated Factory ledger event from the command line."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    append = commands.add_parser("append", help="append one ledger event")
    append.add_argument("--file", required=True)
    append.add_argument("--run-id", required=True)
    append.add_argument("--stage", choices=ALLOWED_STAGES, required=True)
    append.add_argument("--status", choices=("started", "success", "failure"), required=True)
    append.add_argument("--cost-usd", type=float)
    append.add_argument("--issue", type=int)
    args = parser.parse_args()

    fields = {}
    if args.cost_usd is not None:
        fields["cost_usd"] = args.cost_usd
    if args.issue is not None:
        fields["issue"] = args.issue
    try:
        event = make_event(args.run_id, args.stage, args.status, **fields)
    except ValueError as error:
        parser.error(str(error))
    append_event(args.file, event)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
