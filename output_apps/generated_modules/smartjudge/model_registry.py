"""Loader for config/models.yaml (docs/STRATEGY.md §3, W12).

One registry, three readers: llm_router.py (product tiers: free/cheap/strong,
plus stt/tts), src/automation/provider_base.py (builder roles: architect/
executor/reviewer/mechanical), and scripts/check_models.py (freshness/price
audit against the live OpenRouter catalogue).

    from output_apps.generated_modules.smartjudge import model_registry
    model_registry.role_models("cheap")   # -> ["deepseek/deepseek-v4-flash-0731", ...]
    model_registry.load()                 # -> full parsed dict, for tooling

This module never makes a network call and never reads a secret. It only
parses a YAML file that is checked into the repo.
"""

from __future__ import annotations

import functools
import pathlib
from typing import Any

REGISTRY_PATH = pathlib.Path(__file__).resolve().parents[3] / "config" / "models.yaml"


class ModelRegistryError(RuntimeError):
    """Raised when config/models.yaml is missing or malformed."""


@functools.lru_cache(maxsize=1)
def load(path: pathlib.Path | None = None) -> dict[str, Any]:
    """Parse and return config/models.yaml. Cached; pass a path to bypass the cache (tests)."""
    target = path or REGISTRY_PATH
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - pyyaml is a declared dependency
        raise ModelRegistryError(
            "PyYAML is required to read config/models.yaml (pip install pyyaml)"
        ) from exc

    try:
        text = target.read_text(encoding="utf-8")
    except OSError as exc:
        raise ModelRegistryError(f"cannot read {target}: {exc}") from exc

    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise ModelRegistryError(f"invalid YAML in {target}: {exc}") from exc

    if not isinstance(data, dict) or not isinstance(data.get("roles"), dict):
        raise ModelRegistryError(f"{target} must be a mapping with a top-level 'roles' key")
    return data


def _load_uncached(path: pathlib.Path | None = None) -> dict[str, Any]:
    """Same as load() but never returns a cached/stale copy (tests, check_models.py)."""
    load.cache_clear()
    try:
        return load(path)
    finally:
        load.cache_clear()


def roles(path: pathlib.Path | None = None) -> dict[str, Any]:
    """The full ``roles:`` mapping from config/models.yaml."""
    data = load(path) if path is None else _load_uncached(path)
    return data["roles"]


def role_models(role: str, path: pathlib.Path | None = None) -> list[str]:
    """Ordered list of model ids (primary first, then fallbacks) for a role.

    Raises ModelRegistryError if the role is not defined. Callers that need a
    graceful fallback (e.g. llm_router.py, so an env-var-only setup still
    works if the registry file is ever absent) should catch that.
    """
    role_data = roles(path).get(role)
    if role_data is None:
        raise ModelRegistryError(f"unknown role {role!r} in config/models.yaml")
    return [m["id"] for m in role_data.get("models", []) if m.get("id")]


def role_entries(role: str, path: pathlib.Path | None = None) -> list[dict[str, Any]]:
    """Full model entries (id, price_per_1m, note) for a role, in order."""
    role_data = roles(path).get(role)
    if role_data is None:
        raise ModelRegistryError(f"unknown role {role!r} in config/models.yaml")
    return list(role_data.get("models", []))


def data_policy(role: str, path: pathlib.Path | None = None) -> str:
    role_data = roles(path).get(role)
    if role_data is None:
        raise ModelRegistryError(f"unknown role {role!r} in config/models.yaml")
    return role_data.get("data_policy", "standard")


def all_role_names(path: pathlib.Path | None = None) -> list[str]:
    return list(roles(path).keys())
