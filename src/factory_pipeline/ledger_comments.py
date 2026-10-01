"""Durable Factory run-ledger events stored in issue-comment HTML comments."""

from __future__ import annotations

import json
import re
from typing import Any

from .run_ledger import _safe, summarize

_COMMENT_RE = re.compile(r"<!--\s*roxira-ledger\s+(.*?)\s*-->", re.DOTALL)
def encode_event(event: dict[str, Any]) -> str:
    """Encode an event as a compact, deterministic hidden issue comment."""
    payload = json.dumps(event, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    if "-->" in payload:
        raise ValueError("ledger event contains an HTML comment terminator")
    if not all(_safe(value) for value in event.values()):
        raise ValueError("ledger event appears to contain a secret")
    return f"<!-- roxira-ledger {payload} -->"


def decode_comments(bodies: list[str]) -> list[dict[str, Any]]:
    """Extract valid, distinct ledger events from issue-comment bodies."""
    events_by_payload: dict[str, dict[str, Any]] = {}
    for body in bodies:
        for match in _COMMENT_RE.finditer(body):
            payload = match.group(1)
            try:
                event = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict):
                continue
            canonical = json.dumps(
                event, ensure_ascii=False, separators=(",", ":"), sort_keys=True
            )
            events_by_payload.setdefault(canonical, event)
    return sorted(events_by_payload.values(), key=lambda event: str(event.get("ts", "")))


def build_summary(bodies: list[str]) -> dict[str, Any]:
    """Build the normal Factory ledger summary from issue-comment bodies."""
    return summarize(decode_comments(bodies))
