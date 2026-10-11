"""Budget-capped OpenRouter call for the self-improvement loop. Stdlib only.

Policy (owner rule): only the `cheap` role of config/models.yaml (deepseek flash), reasoning
disabled, never a Gemini Pro model, never a :free model for anything derived from customer text.
The prompt must contain anonymised short topic labels only. The key is read from the environment.
"""
import json
import os
import urllib.request

import budget
import common

URL = os.environ.get("SELFIMPROVE_LLM_URL", "https://openrouter.ai/api/v1/chat/completions")
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


def ask(ledger: budget.Ledger, prompt: str, what: str, system: str = "") -> str | None:
    """One chat completion, or None when the key is missing / budget is exhausted / the call fails."""
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        return None
    model = pick_model()
    est = estimate_usd(model, len(prompt) + len(system))
    if not ledger.can_afford(est):
        return None
    body = {"model": model, "max_tokens": MAX_OUT_TOKENS, "temperature": 0.2,
            "reasoning": {"enabled": False},
            "messages": ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 - fixed https URL
            data = json.loads(resp.read())
    except Exception:  # noqa: BLE001 - network/provider failure: skip the optional LLM step
        return None
    usage = data.get("usage") or {}
    p_in, p_out = common.model_prices(model)
    real = (usage.get("prompt_tokens", 0) * p_in + usage.get("completion_tokens", 0) * p_out) / 1e6
    try:
        ledger.charge(real or est, what)
    except budget.BudgetExceeded:
        pass  # already spent; the next call is refused
    try:
        return str(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError):
        return None
