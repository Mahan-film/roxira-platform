"""Pure per-run capability grants: mint and verify scoped authority.

Implements the internal capability-token contract from
`docs/research/nextgen/A_agent_native_architecture.md` section 2: one
short-lived grant per run, constrained to repository, branch, file-path
prefixes, tool ids, budget and expiry. Pure library; no workflow wiring.
"""

from __future__ import annotations

import hashlib
import json
import posixpath
import re

TOOL_NAME_RE = re.compile(r"^[a-z0-9_.-]{1,40}$")
MAX_TTL_S = 86400
MAX_BUDGET_USD = 5.0
_EPS = 1e-9


def _canonical(payload: dict) -> str:
    """Deterministic JSON of a grant payload (sorted keys, no whitespace)."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _grant_id(payload: dict) -> str:
    """sha256 of the canonical JSON of every grant field except grant_id."""
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


def mint(
    run_id: str,
    repo: str,
    branch: str,
    paths: list[str],
    tools: list[str],
    budget_usd: float,
    ttl_s: int,
    now: float,
) -> dict:
    """Mint one short-lived, path/tool/budget-scoped grant for a single run.

    Raises ValueError on authority that is empty, too broad or too long-lived.
    """
    if not paths:
        raise ValueError("paths must not be empty")
    if not tools:
        raise ValueError("tools must not be empty")
    if ttl_s > MAX_TTL_S:
        raise ValueError(f"ttl_s must be <= {MAX_TTL_S}")
    if budget_usd <= 0 or budget_usd > MAX_BUDGET_USD:
        raise ValueError(f"budget_usd must be in (0, {MAX_BUDGET_USD}]")
    for path in paths:
        if not path or path.startswith("/") or ".." in path:
            raise ValueError(f"unsafe path: {path!r}")
    for tool in tools:
        if not TOOL_NAME_RE.match(tool):
            raise ValueError(f"invalid tool name: {tool!r}")

    payload = {
        "run_id": run_id,
        "repo": repo,
        "branch": branch,
        "paths": list(paths),
        "tools": list(tools),
        "budget_usd": budget_usd,
        "ttl_s": ttl_s,
        "expires_at": now + ttl_s,
    }
    return {**payload, "grant_id": _grant_id(payload)}


def _path_allowed(path: str, prefixes: list[str]) -> bool:
    """True if `path` sits under one granted prefix on a path-component boundary.

    `src/a` grants `src/a` and `src/a/b.py` but not `src/ab.py`, and a `..`
    segment that would escape the prefix does not match.
    """
    normalized = posixpath.normpath(path)
    for prefix in prefixes:
        base = posixpath.normpath(prefix)
        if normalized == base or normalized.startswith(base + "/"):
            return True
    return False


def verify(
    grant: dict,
    *,
    now: float,
    path: str | None = None,
    tool: str | None = None,
    spend_usd: float = 0.0,
    spent_so_far: float = 0.0,
) -> list[str]:
    """Return the reasons `grant` does NOT allow the request (empty = allowed)."""
    reasons: list[str] = []

    payload = {key: value for key, value in grant.items() if key != "grant_id"}
    if _grant_id(payload) != grant.get("grant_id"):
        reasons.append("grant_id mismatch")

    if now >= grant.get("expires_at", 0):
        reasons.append("expired")

    if path is not None and not _path_allowed(path, grant.get("paths") or []):
        reasons.append("path outside granted prefixes")

    if tool is not None and tool not in (grant.get("tools") or []):
        reasons.append("tool not granted")

    if spent_so_far + spend_usd > (grant.get("budget_usd", 0) + _EPS):
        reasons.append("budget exceeded")

    return reasons
