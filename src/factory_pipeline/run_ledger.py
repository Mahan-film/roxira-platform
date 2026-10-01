"""Redacted, JSONL-backed event records for Factory runs."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path
ALLOWED_STAGES = ("intake", "research", "approval", "plan", "task", "review", "preview", "deploy", "verify", "report")
_STATUSES = ("started", "ok", "failed", "skipped")
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
    if any(key in _FORBIDDEN or _SECRET.search(key) or not _safe(value) for key, value in fields.items()):
        raise ValueError("unsafe ledger field")
    ts = now or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
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
            "failed": [stage for stage, status in stages.items() if status == "failed"],
            "total_cost_usd": total}
