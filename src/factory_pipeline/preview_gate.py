"""Pure planning helpers for short-lived preview environments."""

from __future__ import annotations

from hashlib import sha1
import re


_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$")
_FORBIDDEN_PORTS = frozenset({80, 443, 5432, 6333, 6379, 8000})


def validate_slug(slug: str) -> str:
    """Return a safe preview slug or reject an unsafe one."""
    if not _SLUG_RE.fullmatch(slug) or slug.startswith("roxira"):
        raise ValueError("invalid preview slug")
    return slug


def container_name(slug: str) -> str:
    """Return the isolated container name for a preview slug."""
    return f"preview-{validate_slug(slug)}"


def host_port_for(slug: str, base: int = 18000, span: int = 100) -> int:
    """Select a stable, non-production host port for ``slug``."""
    if span <= 0:
        raise ValueError("port span must be positive")

    slug = validate_slug(slug)
    port = base + (int(sha1(slug.encode("utf-8")).hexdigest(), 16) % span)
    if port in _FORBIDDEN_PORTS:
        raise ValueError("preview port is reserved")
    return port


def compose_limits() -> dict[str, str | int]:
    """Return the fixed resource limits for one preview container."""
    return {"cpus": "1.0", "mem_limit": "1g", "pids_limit": 256}


def is_expired(created_epoch: float, now_epoch: float, ttl_s: int = 86400) -> bool:
    """Return whether a preview has reached its time-to-live."""
    return now_epoch - created_epoch >= ttl_s


def plan_action(
    existing: dict[str, float],
    slug: str,
    now_epoch: float,
    max_alive: int = 2,
    ttl_s: int = 86400,
) -> dict[str, object]:
    """Choose whether a preview can be reused, created, or must be rejected."""
    slug = validate_slug(slug)
    expired = [
        existing_slug
        for existing_slug, created_epoch in existing.items()
        if is_expired(created_epoch, now_epoch, ttl_s)
    ]

    if slug in existing and slug not in expired:
        return {"action": "reuse"}

    alive_count = len(existing) - len(expired)
    if alive_count < max_alive:
        return {"action": "create", "teardown": expired}
    return {"action": "reject", "reason": "limit"}
