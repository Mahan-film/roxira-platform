"""Load config/fallback_chains.yaml and resolve which steps have keys set."""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import yaml

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "config" / "fallback_chains.yaml"


def load_config(path: Path | None = None) -> dict[str, Any]:
    with open(path or DEFAULT_PATH, encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def _has_key(env_names: list[str], env: Mapping[str, str]) -> bool:
    return any((env.get(n) or "").strip() for n in env_names)


def step_status(
    config: dict[str, Any], chain: str, env: Mapping[str, str] | None = None
) -> list[dict[str, Any]]:
    """[{step, active, env}] in chain order. Env var NAMES only, never values."""
    env = os.environ if env is None else env
    out = []
    for step in config["chains"][chain]["steps"]:
        names = list(config["providers"][step]["env"])
        out.append({"step": step, "active": _has_key(names, env), "env": names})
    return out


def active_steps(
    config: dict[str, Any], chain: str, env: Mapping[str, str] | None = None
) -> list[str]:
    return [s["step"] for s in step_status(config, chain, env) if s["active"]]
