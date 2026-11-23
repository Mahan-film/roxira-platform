"""Box lane policy: model ladder and path scopes for lanes L5-L7 (private-flip decision B1, AGENTS.md section 4a).

Stdlib only, no import-time side effects. The policy is one JSON file (default template:
config/box_lane_policy.json, paths and step names only, never secrets). It is ACTIVE only when the env var
ROXIRA_LANE_POLICY points at it, so nothing changes anywhere else (mac, server, CI).

What it decides
  ladder      the taskq ladder the box uses instead of taskq.DEFAULT_LADDER (every step must be a group the box key
              allows; see STEP_GROUP)
  scopes      per-lane path allowlist (repo-relative directories or files, no globs). The operator env
              ORCH_SCOPE_<LANE> still overrides the table, but is checked against the same deny rules
  deny        paths no lane may touch. A scope is refused when it is inside a denied path OR contains one
              (a parent such as `output_apps/` would let the lane reach the denied child)
  deny_names  directory or file names that are denied wherever they appear in the tree (migrations, auth, ...).
              Checked on the scope path itself and, when a repo root is given, on everything below it
  require_scope  true: a lane without any scope is refused (no scope would mean "the whole repo")

Issue text never reaches this module: scopes come from this file or from operator env only.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

POLICY_ENV = "ROXIRA_LANE_POLICY"
LADDER_STEPS = ("best", "free", "ds-flash", "strong", "light", "paid")
# Gateway group each step calls; None = a direct provider call (not available on the box: it holds no provider keys).
STEP_GROUP: dict[str, str | None] = {
    "best": "best-all",
    "free": "agent-strong-free",
    "light": "agent-light-free",
    "paid": "agent-free-paid",
    "ds-flash": None,
    "strong": None,
}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".next", "dist", "build"}
MAX_WALK = 20000  # files visited per scope; a bigger tree than this is not a legitimate narrow scope
_GLOB = re.compile(r"[*?\[\]{}]")


class PolicyError(ValueError):
    """The policy file is unreadable or malformed. Callers fail closed: no policy file means no run."""


def policy_path() -> Path | None:
    raw = os.environ.get(POLICY_ENV, "").strip()
    return Path(raw) if raw else None


def load(path: Path | str | None = None) -> dict:
    """The parsed policy, or {} when no policy is configured (inactive). A configured but bad file raises PolicyError."""
    p = Path(path) if path else policy_path()
    if p is None:
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise PolicyError(f"cannot read lane policy {p}: {exc}") from exc
    if not isinstance(data, dict):
        raise PolicyError(f"lane policy {p} must be a JSON object")
    ladder = data.get("ladder")
    if ladder is not None:
        if not isinstance(ladder, list) or not ladder or any(s not in LADDER_STEPS for s in ladder):
            raise PolicyError(f"lane policy ladder must be a non-empty list of {', '.join(LADDER_STEPS)}")
    for key in ("deny", "deny_names"):
        if not isinstance(data.get(key, []), list) or any(not isinstance(x, str) for x in data.get(key, [])):
            raise PolicyError(f"lane policy {key} must be a list of strings")
    lanes = data.get("lanes", {})
    if not isinstance(lanes, dict):
        raise PolicyError("lane policy lanes must be an object")
    return data


def ladder(policy: dict) -> list[str] | None:
    """The policy's ladder, or None when the policy has none (callers keep their default)."""
    out = policy.get("ladder")
    return list(out) if out else None


def ladder_groups(steps: list[str]) -> dict[str, str | None]:
    return {s: STEP_GROUP.get(s) for s in steps}


def norm(path: str) -> str:
    """Repo-relative path without leading ./ or trailing /; '' for anything that means the whole repo."""
    p = path.strip().replace("\\", "/")
    return "/".join(seg for seg in p.split("/") if seg not in ("", "."))


def overlaps(scope: str, other: str) -> bool:
    """True when one path is the other or lies inside it (either direction)."""
    s, o = norm(scope), norm(other)
    return bool(s) and bool(o) and (s == o or s.startswith(o + "/") or o.startswith(s + "/"))


def lane_scopes(lane: str, policy: dict, environ: dict | None = None) -> list[str]:
    """Scopes for a lane: operator env ORCH_SCOPE_<LANE> wins, else the policy table. Never from issue text."""
    env = os.environ if environ is None else environ
    raw = env.get(f"ORCH_SCOPE_{lane.upper()}", "")
    from_env = [s.strip() for s in raw.split(",") if s.strip()]
    if from_env:
        return from_env
    table = (policy.get("lanes") or {}).get(lane.upper()) or {}
    return [s for s in table.get("scopes", []) if isinstance(s, str) and s.strip()]


def check_scopes(scopes: list[str], policy: dict, repo_root: Path | str | None = None) -> list[str]:
    """Problems that make a scope list unacceptable (empty list = fine). Pure when repo_root is None.

    With a repo_root the tree below every scope is also walked for deny_names, so a scope that merely CONTAINS
    a `migrations` or `auth` directory is refused as well."""
    if not policy:
        return []
    problems: list[str] = []
    if not scopes:
        if policy.get("require_scope"):
            problems.append("no scope: with require_scope an empty scope would mean the whole repo")
        return problems
    deny = [norm(d) for d in policy.get("deny", []) if norm(d)]
    names = {n for n in policy.get("deny_names", []) if n}
    for raw in scopes:
        s = norm(raw)
        if not s or ".." in s.split("/") or raw.strip().startswith("/") or _GLOB.search(s):
            problems.append(f"scope {raw!r} is not a plain repo-relative path (no globs, no .., not the whole repo)")
            continue
        for d in deny:
            if overlaps(s, d):
                where = "inside" if s == d or s.startswith(d + "/") else "a parent of"
                problems.append(f"scope {s!r} is {where} denied path {d!r}")
        hit = [seg for seg in s.split("/") if seg in names]
        if hit:
            problems.append(f"scope {s!r} contains the denied name {hit[0]!r}")
        if repo_root is not None:
            problems += _walk_names(Path(repo_root), s, names)
    return problems


def _walk_names(root: Path, scope: str, names: set[str]) -> list[str]:
    base = root / scope
    if not names or not base.is_dir():
        return []
    seen = 0
    found: list[str] = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for entry in dirnames + filenames:
            seen += 1
            if entry in names:
                rel = (Path(dirpath) / entry).relative_to(root).as_posix()
                found.append(f"scope {scope!r} contains denied path {rel!r}")
                if len(found) >= 3:
                    return found
        if seen > MAX_WALK:
            found.append(f"scope {scope!r} is too large to audit (> {MAX_WALK} entries): narrow it")
            return found
    return found


def problems_for_lane(lane: str, policy: dict | None = None, repo_root: Path | str | None = None,
                      environ: dict | None = None) -> list[str]:
    """Policy problems for the scopes a lane would get. [] when no policy is active."""
    pol = load() if policy is None else policy
    if not pol:
        return []
    return check_scopes(lane_scopes(lane, pol, environ), pol, repo_root)
