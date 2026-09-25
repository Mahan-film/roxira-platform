"""Project slug generation for `projects/<slug>/` (Project Factory v1, in-repo build).

Same shape as `output_apps/ecosystem_core/src/factory/agent_runner.py`'s
`slugify()` (ASCII-fold, hyphenate, truncate) so a Persian-only brief title
still yields a short, usable directory name instead of crashing the planner,
plus a collision-avoidance helper agent_runner's version doesn't need (a
git-branch slug never has to be unique against a live directory listing the
way a `projects/<slug>/` path does).
"""

from __future__ import annotations

import re

_STRIP_RE = re.compile(r"[^a-z0-9]+")


def slugify_project(text: str, max_len: int = 40, fallback: str = "project") -> str:
    """Lowercase, ASCII, hyphenated slug. Non-ASCII (e.g. a Farsi-only brief
    title) collapses to nothing gracefully, falling back to `fallback`
    rather than producing an empty or crashing path."""
    ascii_text = (text or "").encode("ascii", "ignore").decode("ascii")
    slug = _STRIP_RE.sub("-", ascii_text.lower()).strip("-")
    slug = slug[:max_len].strip("-")
    return slug or fallback


def unique_slug(base_slug: str, existing: set[str]) -> str:
    """Append `-2`, `-3`, ... until `base_slug` no longer collides with
    `existing` (e.g. the set of directory names already under `projects/`)."""
    if base_slug not in existing:
        return base_slug
    n = 2
    while f"{base_slug}-{n}" in existing:
        n += 1
    return f"{base_slug}-{n}"
