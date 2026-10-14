"""Load and expand config/key_pool.yaml into ordered deployments (no secrets, names only).

Shared by render_litellm.py (gateway config) and scripts/dev/llm_pool.py (direct client).
Model ids come from config/models.yaml through model_registry when a spec uses role/alias.
"""
from __future__ import annotations

import os
import pathlib
import sys
from dataclasses import dataclass, field
from typing import Any

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[3]
DEFAULT_POOL = ROOT / "config" / "key_pool.yaml"
_SMARTJUDGE = ROOT / "output_apps" / "generated_modules" / "smartjudge"

# Sentinel key_env for providers that need no key (e.g. the local TEI embeddings
# service). The renderer writes `api_key: "none"` for it instead of os.environ/.
NO_KEY = "none"


class PoolError(ValueError):
    pass


@dataclass
class Deployment:
    group: str
    provider: str
    tier: str
    data_policy: str
    base_url: str
    litellm_prefix: str
    key_env: str
    model: str
    order: int
    mode: str | None = None
    api_base: str | None = None
    rpm: int | None = None
    tpm: int | None = None
    extra_body: dict[str, Any] = field(default_factory=dict)

    @property
    def keyless(self) -> bool:
        return self.key_env == NO_KEY

    @property
    def free_model(self) -> bool:
        return self.tier == "free" or is_free_model_id(self.model)

    @property
    def litellm_model(self) -> str:
        return f"{self.litellm_prefix}/{self.model}"


def is_free_model_id(model_id: str) -> bool:
    return model_id.endswith(":free") or model_id == "openrouter/free"


def _registry():
    if str(_SMARTJUDGE) not in sys.path:
        sys.path.insert(0, str(_SMARTJUDGE))
    import model_registry

    return model_registry


def load_pool(path: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    p = pathlib.Path(path or os.environ.get("KEY_POOL_CONFIG") or DEFAULT_POOL)
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or "providers" not in data or "groups" not in data:
        raise PoolError(f"{p}: needs `providers` and `groups`")
    return data


def _num(v: Any) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def resolve_model_specs(
    specs: list[dict[str, Any]], models_path: pathlib.Path | None = None
) -> list[tuple[str, dict[str, Any]]]:
    """(model id, spec) pairs in order, first occurrence wins (dedup by id)."""
    out: list[tuple[str, dict[str, Any]]] = []
    seen: set[str] = set()
    for spec in specs:
        if "id" in spec:
            got = [str(spec["id"])]
        elif "role" in spec and "alias" in spec:
            entries = _registry().role_entries(spec["role"], models_path)
            got = [e["id"] for e in entries if e.get("alias") == spec["alias"]][:1]
            if not got:
                raise PoolError(f"no alias {spec['alias']!r} in models.yaml role {spec['role']!r}")
        elif "role" in spec:
            all_ids = _registry().role_models(spec["role"], models_path)
            got = all_ids[: int(spec.get("take", len(all_ids)))]
        else:
            raise PoolError(f"bad model spec {spec!r}")
        for mid in got:
            if mid not in seen:
                seen.add(mid)
                out.append((mid, spec))
    return out


def resolve_models(specs: list[dict[str, Any]], models_path: pathlib.Path | None = None) -> list[str]:
    return [mid for mid, _ in resolve_model_specs(specs, models_path)]


def provider_keys(prov: dict[str, Any], names: set[str] | None) -> list[str]:
    """Key env-var NAMES to use. names=None means 'assume all are set' (offline render/tests).

    A provider with no `keys`/`keys_any` (or only empty ones) needs no key at all: it is
    always available and gets the NO_KEY sentinel.
    """
    explicit = list(prov.get("keys", []))
    if explicit:
        return [k for k in explicit if names is None or k in names]
    any_of = list(prov.get("keys_any", []))
    if any_of:
        for k in any_of:
            if names is None or k in names:
                return [k]
        return []
    return [NO_KEY]


def validate_group(name: str, group: dict[str, Any], deps: list[Deployment]) -> None:
    req = group.get("require") or {}
    for d in deps:
        if req.get("data_policy") and d.data_policy != req["data_policy"]:
            raise PoolError(f"group {name}: provider {d.provider} has data_policy {d.data_policy}, needs {req['data_policy']}")
        if req.get("forbid_free") and d.free_model:
            raise PoolError(f"group {name}: {d.provider}/{d.model} is free-tier, forbidden here")
    if name == "private":  # hard floor, independent of what the YAML `require` says
        for d in deps:
            if d.data_policy == "may_log" or d.free_model:
                raise PoolError(f"group private must never contain {d.provider}/{d.model} (may_log or free)")


def group_deployments(
    pool: dict[str, Any], group: str, names: set[str] | None = None, models_path: pathlib.Path | None = None
) -> list[Deployment]:
    """Ordered deployments of a group. `order` rises provider by provider; keys of one model share it."""
    if group not in pool["groups"]:
        raise PoolError(f"unknown group {group!r}")
    g = pool["groups"][group]
    out: list[Deployment] = []
    order = 0
    for pname in g["providers"]:
        prov = pool["providers"].get(pname)
        if prov is None:
            raise PoolError(f"group {group}: unknown provider {pname!r}")
        keys = provider_keys(prov, names)
        lim = prov.get("limits", {})
        api_base = prov.get("api_base")
        for model, spec in resolve_model_specs(prov["models"], models_path):
            if not keys:
                continue
            order += 1
            for k in keys:
                out.append(
                    Deployment(
                        group=group, provider=pname, tier=prov["tier"], data_policy=prov["data_policy"],
                        base_url=prov["base_url"], litellm_prefix=prov["litellm_prefix"], key_env=k,
                        model=model, order=order, mode=spec.get("mode"), api_base=api_base,
                        rpm=_num(lim.get("rpm")), tpm=_num(lim.get("tpm")),
                        extra_body=dict(prov.get("extra_body") or {}),
                    )
                )
    validate_group(group, g, out)
    return out


def all_key_names(pool: dict[str, Any]) -> list[str]:
    seen: list[str] = []
    for prov in pool["providers"].values():
        for k in list(prov.get("keys", [])) + list(prov.get("keys_any", [])):
            if k not in seen:
                seen.append(k)
    master = pool.get("gateway", {}).get("master_key_env")
    if master and master not in seen:
        seen.append(master)
    return seen


def parse_env_names(path: str | os.PathLike[str], wanted: list[str]) -> dict[str, str]:
    """Parse KEY=VALUE lines (never sourced), keep only whitelisted names with non-empty values."""
    out: dict[str, str] = {}
    p = pathlib.Path(path).expanduser()
    if not p.is_file():
        return out
    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        n, _, v = line.partition("=")
        n = n.removeprefix("export ").strip()
        v = v.strip().strip('"').strip("'")
        if n in wanted and v and n not in out:
            out[n] = v
    return out
