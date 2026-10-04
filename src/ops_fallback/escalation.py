"""Quality-gated tier escalation: cheap first, stronger only when the gate fails.

Pure stdlib apart from the model registry read. The model call, the gate, the
tier->model resolver and the cost estimator are all injectable, so tests need
no network. No model id is hardcoded: tiers resolve through config/models.yaml
roles (see config/escalation.yaml for the tier->role map).
"""

from __future__ import annotations

import inspect
from collections.abc import Callable, Sequence
from typing import Any

# Tier name -> models.yaml role. "mid" has no dedicated role yet; it reuses the
# strong role until one is added (change it in config/escalation.yaml).
DEFAULT_TIER_ROLES = {"free": "free", "cheap": "cheap", "mid": "strong", "strong": "strong"}

Gate = Callable[[Any], tuple[bool, list[str]]]


class EscalationError(RuntimeError):
    """Base class for escalation failures."""


class SensitiveFreeTierError(EscalationError):
    """sensitive=True but a requested tier resolves to a free/non_sensitive_only model."""


class CostCapExceeded(EscalationError):
    """The very first attempt would already exceed max_cost_usd."""


def is_free_id(model_id: str) -> bool:
    return model_id.endswith(":free") or model_id == "openrouter/free"


def _registry_resolver(tier: str, tier_roles: dict[str, str]) -> dict[str, Any]:
    from output_apps.generated_modules.smartjudge import model_registry as mr

    role = tier_roles.get(tier, tier)
    entries = mr.role_entries(role)
    return {
        "role": role,
        "ids": [e["id"] for e in entries if e.get("id")],
        "free": mr.data_policy(role) == "non_sensitive_only",
        "price": (entries[0].get("price_per_1m") or {}) if entries else {},
    }


def estimate_usd(price: dict[str, Any], tokens_in: int, tokens_out: int) -> float:
    return (
        tokens_in * float(price.get("in") or 0) + tokens_out * float(price.get("out") or 0)
    ) / 1_000_000


def _prepare(
    tiers: Sequence[str],
    sensitive: bool,
    resolve: Callable[[str], dict[str, Any]] | None,
    tier_roles: dict[str, str] | None,
) -> dict[str, dict[str, Any]]:
    if not tiers:
        raise ValueError("tiers must not be empty")
    roles = {**DEFAULT_TIER_ROLES, **(tier_roles or {})}
    res = resolve or (lambda t: _registry_resolver(t, roles))
    resolved = {t: res(t) for t in tiers}
    if sensitive:
        for t, info in resolved.items():
            if info.get("free") or any(is_free_id(i) for i in info.get("ids", [])):
                raise SensitiveFreeTierError(
                    f"tier {t!r} resolves to a free/non-sensitive model; refused for sensitive data"
                )
    return resolved


def _result(
    result: Any, tier_used: str | None, attempts: list, spent: float, ok: bool, stopped: str | None
) -> dict[str, Any]:
    return {
        "result": result,
        "tier_used": tier_used,
        "attempts": attempts,
        "est_usd": round(spent, 6),
        "ok": bool(ok),
        "stopped": stopped,
    }


async def _loop(
    tiers: Sequence[str],
    call: Callable[[str, list[str]], Any],
    gate: Gate,
    max_cost_usd: float,
    resolved: dict[str, dict[str, Any]],
    cost_of: Callable[[Any, str], float | None] | None,
    est_tokens: tuple[int, int],
) -> dict[str, Any]:
    attempts: list[dict[str, Any]] = []
    spent = 0.0
    result: Any = None
    tier_used: str | None = None
    ok = False
    stopped: str | None = None
    for t in tiers:
        info = resolved[t]
        est = estimate_usd(info.get("price") or {}, *est_tokens)
        if spent + est > max_cost_usd:
            if not attempts:
                raise CostCapExceeded(f"first tier {t!r} would exceed the cost cap")
            stopped = "cost_cap"
            break
        result = call(t, list(info.get("ids", [])))
        if inspect.isawaitable(result):
            result = await result
        tier_used = t
        actual = cost_of(result, t) if cost_of else None
        spent += est if actual is None else float(actual)
        ok, reasons = gate(result)
        attempts.append({"tier": t, "ok": bool(ok), "reasons": list(reasons)})
        if ok:
            break
    return _result(result, tier_used, attempts, spent, ok, stopped)


def run_with_escalation(
    tiers: Sequence[str],
    call: Callable[[str, list[str]], Any],
    gate: Gate,
    *,
    max_cost_usd: float,
    sensitive: bool,
    resolve: Callable[[str], dict[str, Any]] | None = None,
    cost_of: Callable[[Any, str], float | None] | None = None,
    tier_roles: dict[str, str] | None = None,
    est_tokens: tuple[int, int] = (2000, 1000),
) -> dict[str, Any]:
    """Try tiers in order; return on the first result that passes ``gate``.

    ``call(tier, model_ids)`` performs one attempt (sync). ``resolve(tier)``
    returns {ids, free, price}; default reads the model registry.
    ``cost_of(result, tier)`` gives actual cost (None -> pre-call estimate).
    Returns {result, tier_used, attempts, est_usd, ok, stopped}.
    """
    resolved = _prepare(tiers, sensitive, resolve, tier_roles)
    coro = _loop(tiers, call, gate, max_cost_usd, resolved, cost_of, est_tokens)
    try:
        coro.send(None)
    except StopIteration as done:
        return done.value
    coro.close()
    raise EscalationError("call returned an awaitable; use arun_with_escalation")


async def arun_with_escalation(
    tiers: Sequence[str],
    call: Callable[[str, list[str]], Any],
    gate: Gate,
    *,
    max_cost_usd: float,
    sensitive: bool,
    resolve: Callable[[str], dict[str, Any]] | None = None,
    cost_of: Callable[[Any, str], float | None] | None = None,
    tier_roles: dict[str, str] | None = None,
    est_tokens: tuple[int, int] = (2000, 1000),
) -> dict[str, Any]:
    """Async twin of run_with_escalation; ``call`` may be a coroutine function."""
    resolved = _prepare(tiers, sensitive, resolve, tier_roles)
    return await _loop(tiers, call, gate, max_cost_usd, resolved, cost_of, est_tokens)
