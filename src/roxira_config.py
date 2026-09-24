"""Shared runtime configuration read from the environment.

Secrets have no default: POSTGRES_PASSWORD must be set (see .env.example).
"""
from __future__ import annotations

import os


def postgres_dsn(host: str = "127.0.0.1", port: int | str = 5434) -> str:
    """Build a Postgres DSN from POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB.

    Callers pass the host and port they connect to; user and database default
    to the production names, the password is required.
    """
    password = os.environ.get("POSTGRES_PASSWORD")
    if not password:
        raise RuntimeError("POSTGRES_PASSWORD is not set; add it to .env")
    user = os.environ.get("POSTGRES_USER", "enterprise_admin")
    db = os.environ.get("POSTGRES_DB", "enterprise_db")
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"
