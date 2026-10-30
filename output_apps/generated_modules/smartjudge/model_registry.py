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
import logging
import pathlib
import re
from typing import Any

REGISTRY_PATH = pathlib.Path(__file__).resolve().parents[3] / "config" / "models.yaml"

logger = logging.getLogger(__name__)

# Owner policy (2026-10-10 & 2026-10-24): Gemini Pro and Qwen Coder variants are
# forbidden everywhere. Flash and general instruct ids remain permitted.
_FORBIDDEN_ID_RE = re.compile(
    r"(gemini[-_ .]*[0-9.]*[-_ ]*pro|qwen[-_ .]*[0-9.]*[-_ ]*coder)", re.IGNORECASE
)


class ModelRegistryError(RuntimeError):
    """Raised when config/models.yaml is missing or malformed."""


def is_forbidden_model_id(model_id: str) -> bool:
    """True for ids the owner policy bans from every role (Gemini Pro)."""
    return bool(_FORBIDDEN_ID_RE.search(str(model_id)))


def _drop_forbidden(role: str, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for entry in entries:
        model_id = str(entry.get("id", ""))
        if model_id and is_forbidden_model_id(model_id):
            logger.warning(
                "skipping forbidden model id %r in role %r (owner policy: Gemini Pro is banned)",
                model_id,
                role,
            )
            continue
        kept.append(entry)
    return kept


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
    entries = [m for m in role_data.get("models", []) if m.get("id")]
    return [m["id"] for m in _drop_forbidden(role, entries)]


def role_entries(role: str, path: pathlib.Path | None = None) -> list[dict[str, Any]]:
    """Full model entries (id, price_per_1m, note) for a role, in order."""
    role_data = roles(path).get(role)
    if role_data is None:
        raise ModelRegistryError(f"unknown role {role!r} in config/models.yaml")
    return _drop_forbidden(role, list(role_data.get("models", [])))


def _is_free_tier_id(model_id: str) -> bool:
    return model_id.endswith(":free") or model_id == "openrouter/free"


def models_for(role: str, sensitive: bool, path: pathlib.Path | None = None) -> list[str]:
    """Ordered model ids for one call, filtered by data sensitivity.

    sensitive=True means the payload carries customer/case data (AGENTS.md §4).
    Then every entry marked ``public_code_only: true`` is dropped, and so is any
    ``:free`` / ``openrouter/free`` id even when it is not marked (a `:free` model
    may log or train on prompts). sensitive=False returns the same list as
    role_models(). Use this, not role_models(), at any call site that sends case data.
    """
    ids: list[str] = []
    for entry in role_entries(role, path):
        model_id = str(entry.get("id", ""))
        if not model_id:
            continue
        if sensitive and (entry.get("public_code_only") is True or _is_free_tier_id(model_id)):
            continue
        ids.append(model_id)
    return ids


def data_policy(role: str, path: pathlib.Path | None = None) -> str:
    role_data = roles(path).get(role)
    if role_data is None:
        raise ModelRegistryError(f"unknown role {role!r} in config/models.yaml")
    return role_data.get("data_policy", "standard")


def all_role_names(path: pathlib.Path | None = None) -> list[str]:
    return list(roles(path).keys())
