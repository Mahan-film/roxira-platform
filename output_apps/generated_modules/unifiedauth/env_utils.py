"""Pure environment-parsing helpers (no import-time side effects)."""
from __future__ import annotations

import os


def _int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    """Read an int env var; unset/empty/non-numeric -> default; clamp to [minimum, maximum].

    docker compose passes `VAR=${VAR:-}` as an empty string, which must not crash import.
    """
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        return default
    return max(minimum, min(maximum, value))
