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


# ---- routing: per-task chains and daily cost caps (issue #288) ---------------------------------

DATA_CLASSES = ("public", "tenant-business", "personal")
_POLICY_PATH = REGISTRY_PATH.parent / "ai_data_policy.json"


def task_names(path: pathlib.Path | None = None) -> list[str]:
    data = load(path) if path is None else _load_uncached(path)
    return list((data.get("tasks") or {}).keys())


def task(name: str, path: pathlib.Path | None = None) -> dict[str, Any]:
    data = load(path) if path is None else _load_uncached(path)
    entry = (data.get("tasks") or {}).get(name)
    if entry is None:
        raise ModelRegistryError(f"unknown task {name!r} in config/models.yaml")
    return entry


def _allowed_provider_classes(data_class: str, mode: str | None = None) -> set[str]:
    """Provider classes (may_log / no_log) allowed for a data class (config/ai_data_policy.json).

    Fails closed: a missing or invalid policy file means the strict production rules.
    """
    import json
    import os

    strict = {"public": {"may_log", "no_log"}, "tenant-business": {"no_log"}, "personal": {"no_log"}}
    try:
        policy = json.loads(_POLICY_PATH.read_text(encoding="utf-8"))
        chosen = os.environ.get("ROXIRA_AI_DATA_MODE") or mode or policy["mode"]
        modes = policy["modes"]
        if chosen not in modes:
            return strict.get(data_class, {"no_log"})
        return set(modes[chosen].get(data_class, ["no_log"]))
    except (OSError, ValueError, KeyError):
        return strict.get(data_class, {"no_log"})


def chain_for(
    task_name: str,
    data_class: str | None = None,
    mode: str | None = None,
    path: pathlib.Path | None = None,
) -> list[dict[str, Any]]:
    """Ordered steps for one call: [{role, tier_index, id, price_per_1m}, ...], free first.

    Roles are expanded to model entries in registry order. A role whose data_policy maps to a
    provider class the data class may not use (ai_data_policy.json) is dropped, and so is any
    :free id when the data class is not allowed on may_log providers. ``data_class`` defaults to
    the task's own class and may only be made stricter, never looser.
    """
    entry = task(task_name, path)
    cls = data_class or entry.get("data_class", "personal")
    if cls not in DATA_CLASSES:
        raise ModelRegistryError(f"unknown data class {cls!r}")
    task_cls = entry.get("data_class", "personal")
    if DATA_CLASSES.index(cls) < DATA_CLASSES.index(task_cls):
        cls = task_cls  # never looser than the task declares
    allowed = _allowed_provider_classes(cls, mode)
    class_of = {"non_sensitive_only": "may_log", "standard": "no_log"}
    steps: list[dict[str, Any]] = []
    for idx, role in enumerate(entry.get("chain", [])):
        role_data = roles(path).get(role)
        if role_data is None:
            raise ModelRegistryError(f"task {task_name!r} references unknown role {role!r}")
        role_class = class_of.get(role_data.get("data_policy", "standard"), "no_log")
        for model in _drop_forbidden(role, list(role_data.get("models", []))):
            mid = str(model.get("id", ""))
            if not mid:
                continue
            model_class = "may_log" if (_is_free_tier_id(mid) or model.get("public_code_only")) else role_class
            if model_class not in allowed:
                continue
            steps.append({"role": role, "tier_index": idx, "id": mid, "price_per_1m": model.get("price_per_1m")})
    return steps


def budgets(path: pathlib.Path | None = None) -> dict[str, Any]:
    data = load(path) if path is None else _load_uncached(path)
    return data.get("budgets") or {}


def global_daily_cap_usd(path: pathlib.Path | None = None) -> float | None:
    value = budgets(path).get("global_daily_usd")
    return None if value is None else float(value)


def role_daily_cap_usd(role: str, path: pathlib.Path | None = None) -> float | None:
    """Daily USD cap of a role; None = no cap configured. 0 means the role must not spend."""
    value = (budgets(path).get("roles") or {}).get(role)
    return None if value is None else float(value)
