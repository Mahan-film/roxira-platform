import asyncio

import pytest

from src.ops_fallback.escalation import (
    CostCapExceeded,
    SensitiveFreeTierError,
    arun_with_escalation,
    run_with_escalation,
)

INFO = {
    "free": {"ids": ["m/x:free"], "free": True, "price": {"in": 0, "out": 0}},
    "cheap": {"ids": ["m/c"], "free": False, "price": {"in": 1.0, "out": 1.0}},
    "strong": {"ids": ["m/s"], "free": False, "price": {"in": 10.0, "out": 10.0}},
}


def resolve(tier):
    return INFO[tier]


def make_call(answers):
    seen = []

    def call(tier, ids):
        seen.append((tier, ids))
        return answers[tier]

    return call, seen


def gate_good(result):
    return (result == "good", [] if result == "good" else ["bad"])


def test_cheap_passes_no_escalation():
    call, seen = make_call({"cheap": "good", "strong": "good"})
    out = run_with_escalation(
        ["cheap", "strong"], call, gate_good, max_cost_usd=1, sensitive=True, resolve=resolve
    )
    assert out["tier_used"] == "cheap" and out["ok"]
    assert [s[0] for s in seen] == ["cheap"]


def test_escalates_on_gate_failure():
    call, _ = make_call({"cheap": "bad", "strong": "good"})
    out = run_with_escalation(
        ["cheap", "strong"], call, gate_good, max_cost_usd=1, sensitive=True, resolve=resolve
    )
    assert out["tier_used"] == "strong" and out["ok"]
    assert out["attempts"][0] == {"tier": "cheap", "ok": False, "reasons": ["bad"]}


def test_cost_cap_stops_escalation():
    call, seen = make_call({"cheap": "bad", "strong": "good"})
    # cheap est 0.003, strong est 0.03 -> cap 0.01 allows only cheap
    out = run_with_escalation(
        ["cheap", "strong"], call, gate_good, max_cost_usd=0.01, sensitive=True, resolve=resolve
    )
    assert out["stopped"] == "cost_cap" and not out["ok"]
    assert len(seen) == 1


def test_first_tier_over_cap_raises():
    call, _ = make_call({"strong": "good"})
    with pytest.raises(CostCapExceeded):
        run_with_escalation(
            ["strong"], call, gate_good, max_cost_usd=0.001, sensitive=True, resolve=resolve
        )


def test_sensitive_refuses_free_before_any_call():
    call, seen = make_call({"free": "good", "cheap": "good"})
    with pytest.raises(SensitiveFreeTierError):
        run_with_escalation(
            ["cheap", "free"], call, gate_good, max_cost_usd=1, sensitive=True, resolve=resolve
        )
    assert seen == []


def test_non_sensitive_may_use_free():
    call, _ = make_call({"free": "good"})
    out = run_with_escalation(
        ["free"], call, gate_good, max_cost_usd=1, sensitive=False, resolve=resolve
    )
    assert out["tier_used"] == "free"


def test_actual_cost_used():
    call, _ = make_call({"cheap": "bad", "strong": "good"})
    out = run_with_escalation(
        ["cheap", "strong"],
        call,
        gate_good,
        max_cost_usd=1,
        sensitive=True,
        resolve=resolve,
        cost_of=lambda r, t: 0.25,
    )
    assert out["est_usd"] == 0.5


def test_async_variant():
    async def acall(tier, ids):
        return "good"

    out = asyncio.run(
        arun_with_escalation(
            ["cheap"], acall, gate_good, max_cost_usd=1, sensitive=True, resolve=resolve
        )
    )
    assert out["ok"]


def test_registry_resolution_no_free_for_sensitive():
    out = run_with_escalation(
        ["cheap", "strong"],
        lambda t, ids: "good",
        gate_good,
        max_cost_usd=10,
        sensitive=True,
    )
    assert out["ok"]
