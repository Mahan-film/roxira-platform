"""CORS allowlist for the unified server (env CORS_ALLOW_ORIGINS, comma-separated)."""

from __future__ import annotations

import os

DEFAULT_CORS_ORIGINS = (
    "https://roxira.ir,https://www.roxira.ir,"
    "https://ghazihoushmand.ir,https://www.ghazihoushmand.ir,"
    "https://roxira.net,https://www.roxira.net"
)
CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
CORS_HEADERS = ["Authorization", "Content-Type", "Accept", "X-Requested-With"]


def cors_allowed_origins() -> list[str]:
    """Explicit origin allowlist; never a wildcard (credentials are enabled)."""
    raw = os.environ.get("CORS_ALLOW_ORIGINS") or DEFAULT_CORS_ORIGINS
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip() and o.strip() != "*"]
