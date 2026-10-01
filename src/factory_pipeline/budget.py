"""Pure whole-request budget and circuit-breaker helpers."""

from dataclasses import dataclass


DEFAULT_CAP_USD = 3.00
WARN_FRACTION = 0.8
_EPS = 1e-9  # float comparison tolerance (3.00 * 0.8 == 2.4000000000000004)


@dataclass(frozen=True)
class BudgetState:
    cap_usd: float
    spent_usd: float
    status: str


def evaluate(spent_usd: float, cap_usd: float = DEFAULT_CAP_USD) -> BudgetState:
    """Classify spending against a positive request cap."""
    if cap_usd <= 0 or spent_usd < 0:
        raise ValueError("cap must be positive and spent must be non-negative")
    status = (
        "tripped"
        if spent_usd >= cap_usd - _EPS
        else "warn"
        if spent_usd >= cap_usd * WARN_FRACTION - _EPS
        else "ok"
    )
    return BudgetState(cap_usd, spent_usd, status)


def can_spend(state: BudgetState, estimate_usd: float) -> bool:
    """Return whether an estimated charge fits without crossing the breaker."""
    if estimate_usd < 0:
        raise ValueError("estimate must be non-negative")
    return state.status != "tripped" and state.spent_usd + estimate_usd <= state.cap_usd + _EPS


def from_summary(summary: dict | float, cap_usd: float = DEFAULT_CAP_USD) -> BudgetState:
    """Build a budget state from a run-ledger-compatible summary."""
    spent = summary if isinstance(summary, (int, float)) else (summary or {}).get("total_cost_usd", 0) or 0
    return evaluate(spent, cap_usd)


def render_fa(state: BudgetState) -> str:
    """Render the budget state for Persian status output."""
    labels = {"ok": "عادی", "warn": "هشدار", "tripped": "متوقف شد"}
    return f"بودجه: {state.spent_usd:.2f} از {state.cap_usd:.2f} دلار — {labels[state.status]}"
