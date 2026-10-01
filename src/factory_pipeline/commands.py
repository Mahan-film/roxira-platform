"""Parse owner commands left as comments on a Project Factory parent issue.

Stage 3 (approval) reacts to `/approve` or `/approve <option>` from an
allowlisted actor (see allowlist.py); stage 6 (status) reacts to `/status`.
Both are plain-text issue-comment bodies, so this is string parsing only --
no GitHub call, no side effect.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_APPROVE_RE = re.compile(r"^\s*/approve\b(.*)$", re.IGNORECASE)
_STATUS_RE = re.compile(r"^\s*/status\s*$", re.IGNORECASE)
_REPORT_RE = re.compile(r"^\s*/report\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class ApprovalCommand:
    """`option` is None for a bare `/approve` (accept the recommended option)."""

    option: str | None


def parse_approval_comment(body: str) -> ApprovalCommand | None:
    """Return an ApprovalCommand if any line of `body` is `/approve` or
    `/approve <option>`. Only the first matching line is used. Returns None
    if no line matches."""
    for line in (body or "").splitlines():
        match = _APPROVE_RE.match(line)
        if match:
            option = match.group(1).strip() or None
            return ApprovalCommand(option=option)
    return None


def is_status_command(body: str) -> bool:
    """True if any line of `body` is exactly `/status` (case-insensitive)."""
    return any(_STATUS_RE.match(line) for line in (body or "").splitlines())


def is_report_command(body: str) -> bool:
    """True if any line of `body` is exactly `/report` (case-insensitive)."""
    return any(_REPORT_RE.match(line) for line in (body or "").splitlines())
