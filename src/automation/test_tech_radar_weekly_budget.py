"""Offline, zero-network unit tests for the weekly tech-radar budget cap
(issue #93): the scheduled run must fail closed at its $1.50 ceiling, never
make a paid call that would cross it, and never route research through a
Claude model.

No network, no LLM calls, no import-time side effects -- safe for pytest to
collect and run in CI (see src/conftest.py and src/ci_quarantine_guard.py).
Every BudgetGuard below is driven by an injected snapshot_fn, so no real
OpenRouter GET /api/v1/key call ever happens here.
"""

from __future__ import annotations

import pytest

from output_apps.generated_modules.smartjudge import model_registry
from src.automation.budget_guard import BudgetExceeded, BudgetGuard, BudgetGuardError
from src.automation.project_brief import PROJECT_BRIEF_FINAL_TIER, PROJECT_BRIEF_LAYER_TIER

# The hard per-run ceiling the weekly workflow passes as --max-usd. Kept in
# one place so the workflow and this test cannot drift silently.
WEEKLY_CAP_USD = 1.50


def _guard(usages: list[float], cap: float = WEEKLY_CAP_USD) -> BudgetGuard:
    values = iter(usages)
    return BudgetGuard(max_usd=cap, snapshot_fn=lambda: next(values))


def test_weekly_cap_allows_spend_under_the_ceiling():
    # spent_so_far() takes its own snapshot, so the feed needs a 4th reading.
    guard = _guard([10.00, 10.20, 11.40, 11.40])
    guard.start()  # baseline 10.00
    guard.check("before layer 1")  # spent 0.20
    guard.check("before layer 2")  # spent 1.40, still within 1.50
    assert guard.spent_so_far() == pytest.approx(1.40)


def test_weekly_cap_aborts_before_the_paid_call_that_crosses_it():
    guard = _guard([10.00, 11.51])
    guard.start()  # baseline 10.00
    with pytest.raises(BudgetExceeded) as excinfo:
        guard.check("before final synthesis")
    assert excinfo.value.cap_usd == WEEKLY_CAP_USD
    assert excinfo.value.spent_usd == pytest.approx(1.51)


def test_weekly_cap_fails_closed_when_usage_cannot_be_verified():
    def _unverifiable() -> float:
        raise BudgetGuardError("OPENROUTER_API_KEY is not set")

    guard = BudgetGuard(max_usd=WEEKLY_CAP_USD, snapshot_fn=_unverifiable)
    with pytest.raises(BudgetGuardError):
        guard.start()


def test_weekly_research_tiers_are_free_then_cheap_and_never_claude():
    # Zero-cost default (owner decision 2026-10-01): bulk per-layer work is
    # `free` (public web data only) and the single final synthesis is `cheap`;
    # `strong` is opt-in via RADAR_FINAL_TIER. All ids come from
    # config/models.yaml and none of these roles carries an anthropic/claude
    # model, so this path can never bill Claude.
    assert PROJECT_BRIEF_LAYER_TIER == "free"
    assert PROJECT_BRIEF_FINAL_TIER == "cheap"
    for role in ("free", "cheap", "strong"):
        ids = model_registry.role_models(role)
        assert ids, f"config/models.yaml role {role!r} has no models"
        assert not any(model_id.startswith("anthropic/") for model_id in ids), (role, ids)