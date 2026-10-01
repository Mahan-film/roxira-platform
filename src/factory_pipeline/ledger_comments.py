"""Durable Factory run-ledger events stored in issue-comment HTML comments."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from typing import Any

from .run_ledger import ALLOWED_STAGES, _safe, make_event, summarize

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


def main() -> int:
    """Post a validated Factory ledger event to an issue comment."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    post = commands.add_parser("post", help="post one ledger event to an issue")
    post.add_argument("--issue", required=True, type=int)
    post.add_argument("--run-id", required=True)
    post.add_argument("--stage", choices=ALLOWED_STAGES, required=True)
    post.add_argument(
        "--status", choices=("ok", "failed", "started", "skipped"), required=True
    )
    post.add_argument("--cost-usd", type=float)
    post.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    fields: dict[str, float] = {}
    if args.cost_usd is not None:
        fields["cost_usd"] = args.cost_usd
    try:
        event = make_event(args.run_id, args.stage, args.status, **fields)
        body = encode_event(event)
    except ValueError as error:
        parser.error(str(error))
    if args.dry_run:
        print(body)
        return 0
    subprocess.run(
        ["gh", "issue", "comment", str(args.issue), "--body", body],
        check=True,
        env=os.environ.copy(),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
