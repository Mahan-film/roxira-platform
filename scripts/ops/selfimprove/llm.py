"""Budget-capped LLM call for the self-improvement loop, routed through scripts/dev/llm_route.

Policy (owner rule): try the free attempts of the `selfimprove` chain first (public payload only),
then the `cheap_agent` role; fall back across them on 401/402/403/429/5xx/timeout/empty. The prompt
must contain anonymised short topic labels only, so the payload counts as public. Cost is tracked in
the daily ledger; model ids and prices come from config/models.yaml via the registry.
"""
import os
import sys

import budget
import common

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "dev"))
import llm_route  # noqa: E402

MAX_OUT_TOKENS = 500


def pick_model() -> str:
    for mid in common.role_models("cheap"):
        if mid.endswith(":free") or ("gemini" in mid.lower() and "pro" in mid.lower()):
            continue
        return mid
    raise RuntimeError("no usable model in the cheap role")


def estimate_usd(model: str, prompt_chars: int, max_out: int = MAX_OUT_TOKENS) -> float:
    p_in, p_out = common.model_prices(model)
    return (prompt_chars / 3.0) * p_in / 1e6 + max_out * p_out / 1e6  # ~3 chars/token worst case


def ask(ledger: budget.Ledger, prompt: str, what: str, system: str = "", *, attempts=None) -> str | None:
    """One routed chat completion (free first, then cheap), or None when every attempt fails.

    The payload holds anonymised short topic labels only, so it is declared public and the
    free / may-log attempts are allowed. `attempts` is injectable for tests.
    """
    model = pick_model()
    est = estimate_usd(model, len(prompt) + len(system))
    if not ledger.can_afford(est):
        return None
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    atts = attempts if attempts is not None else llm_route.selfimprove_attempts()
    try:
        res = llm_route.route("selfimprove", messages, atts, max_tokens=MAX_OUT_TOKENS, public=True)
    except (llm_route.AllAttemptsFailed, llm_route.CapReached):
        return None
    try:
        ledger.charge(res.cost_usd, what)
    except budget.BudgetExceeded:
        pass  # already spent; the next call is refused
    return res.text
