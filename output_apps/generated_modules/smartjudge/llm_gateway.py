"""Free-first key-pool gateway routing for product chat/answer calls.

Owner decision 2026-10-14 (AGENTS.md section 4): route free tiers first, paid
models only as fallback. The Roxira LiteLLM key pool already implements that
grouping and exposes it as an OpenAI-compatible endpoint (config/key_pool.yaml,
container ``roxira_keypool``, port 4000).

    SMARTJUDGE_LLM_GATEWAY        base URL, e.g. http://roxira_keypool:4000/v1.
                                  Empty (default) = today's behaviour: call
                                  OpenRouter directly, nothing changes.
    SMARTJUDGE_LLM_GATEWAY_MODEL  gateway group name (default "agent-strong-free";
                                  the gateway itself falls back to paid DeepSeek).
    SMARTJUDGE_LLM_GATEWAY_MODEL_FREE  group for guests/free users (default "best-product-free").
    SMARTJUDGE_LLM_GATEWAY_MODEL_VIP   group for subscribers (default "vip-product").
                                  If neither tier var is set and the legacy MODEL var is set,
                                  the legacy value serves both tiers (backward compatible).
    SMARTJUDGE_LLM_GATEWAY_MODEL_BASIC / _PRO / _PREMIUM / _TEAM  groups for the paid plan levels
                                  (defaults vip-product / vip-pro / vip-premium / vip-team).
    SMARTJUDGE_FREE_PAID_FALLBACK 1 = free users may fall back to the direct paid OpenRouter
                                  path when the gateway fails (old behaviour; default off).
    KEYPOOL_MASTER_KEY            gateway auth, sent as the OpenAI api key.

    SMARTJUDGE_LLM_CALL_TAGS      1 = attach the cost-attribution ``metadata`` (default OFF until
                                  the owner has smoke-tested the free providers with it).

This module never makes a network call and never logs a key. Callers keep their
existing direct OpenRouter path as the fallback when the gateway fails, so chat
never breaks.

Cost attribution: every gateway request body gets a ``metadata`` dict with the
answer id, feature, tenant and plan of the call (``tag()``). LiteLLM consumes it
(it is not forwarded to the provider unless ``enable_preview_features`` is on,
which the key pool never sets) and the key pool's cost_logger writes the
whitelisted ``roxira_*`` keys into requests.jsonl, so cost_report.py can sum
cost per answer and per feature. Entry points set the answer id once with
``call_context()``; every gateway call made inside it inherits the id.
"""

from __future__ import annotations

import contextlib
import contextvars
import logging
import os
import re
import uuid

logger = logging.getLogger("llm_gateway")

ENV_GATEWAY = "SMARTJUDGE_LLM_GATEWAY"
ENV_MODEL = "SMARTJUDGE_LLM_GATEWAY_MODEL"
ENV_MODEL_FREE = "SMARTJUDGE_LLM_GATEWAY_MODEL_FREE"
ENV_MODEL_VIP = "SMARTJUDGE_LLM_GATEWAY_MODEL_VIP"
ENV_MODEL_BASIC = "SMARTJUDGE_LLM_GATEWAY_MODEL_BASIC"
ENV_MODEL_PRO = "SMARTJUDGE_LLM_GATEWAY_MODEL_PRO"
ENV_MODEL_PREMIUM = "SMARTJUDGE_LLM_GATEWAY_MODEL_PREMIUM"
DEFAULT_MODEL_BASIC = "vip-product"
DEFAULT_MODEL_PRO = "vip-pro"
DEFAULT_MODEL_PREMIUM = "vip-premium"
ENV_MODEL_TEAM = "SMARTJUDGE_LLM_GATEWAY_MODEL_TEAM"
DEFAULT_MODEL_TEAM = "vip-team"
PAID_LEVELS = ("basic", "pro", "premium", "team")
_LEVEL_MODEL = {
    "basic": (ENV_MODEL_BASIC, DEFAULT_MODEL_BASIC),
    "pro": (ENV_MODEL_PRO, DEFAULT_MODEL_PRO),
    "premium": (ENV_MODEL_PREMIUM, DEFAULT_MODEL_PREMIUM),
    "team": (ENV_MODEL_TEAM, DEFAULT_MODEL_TEAM),
}
ENV_FREE_PAID_FALLBACK = "SMARTJUDGE_FREE_PAID_FALLBACK"
DEFAULT_MODEL_FREE = "best-product-free"
DEFAULT_MODEL_VIP = "vip-product"
ENV_API_KEY = "KEYPOOL_MASTER_KEY"
DEFAULT_MODEL = "agent-strong-free"


def base_url() -> str:
    """Configured gateway base URL (no trailing slash), or "" when unset."""
    return os.environ.get(ENV_GATEWAY, "").strip().rstrip("/")


def model() -> str:
    """Gateway group to ask for (default ``agent-strong-free``)."""
    return os.environ.get(ENV_MODEL, "").strip() or DEFAULT_MODEL


def is_vip(tier: str | None) -> bool:
    """True for legacy "VIP" and for every paid plan level (basic / pro / premium / team)."""
    value = str(tier or "").strip().lower()
    return value == "vip" or value in PAID_LEVELS


def model_for(tier: str | None) -> str:
    """Gateway group for a plan.

    ``tier`` is a plan level (free / basic / pro / premium / team) or the legacy "VIP"/"FREE".
    basic/pro/premium -> their own group (env override, else vip-product / vip-pro /
    vip-premium / vip-team); legacy VIP -> paid-capable group; everyone else -> free-only group."""
    level = str(tier or "").strip().lower()
    if level in _LEVEL_MODEL:
        env_name, default = _LEVEL_MODEL[level]
        return os.environ.get(env_name, "").strip() or default
    vip = is_vip(tier)
    specific = os.environ.get(ENV_MODEL_VIP if vip else ENV_MODEL_FREE, "").strip()
    if specific:
        return specific
    other = os.environ.get(ENV_MODEL_FREE if vip else ENV_MODEL_VIP, "").strip()
    legacy = os.environ.get(ENV_MODEL, "").strip()
    if legacy and not other:
        return legacy
    return DEFAULT_MODEL_VIP if vip else DEFAULT_MODEL_FREE


def free_paid_fallback_allowed() -> bool:
    """Kill switch: SMARTJUDGE_FREE_PAID_FALLBACK=1 lets free users reach paid models again."""
    return os.environ.get(ENV_FREE_PAID_FALLBACK, "").strip().lower() in ("1", "true", "yes", "on")


def may_use_paid(tier: str | None) -> bool:
    return is_vip(tier) or free_paid_fallback_allowed()


UPSELL_MESSAGE = (
    "در حال حاضر تقاضا بسیار زیاد است و پاسخ‌گویی رایگان موقتاً شلوغ است. "
    "لطفاً یک دقیقه دیگر دوباره تلاش کنید. کاربران دارای اشتراک ویژه در این شرایط اولویت دارند."
)
PLANS_URL = "/plans"


def api_key() -> str:
    """Gateway master key, or "" when unset."""
    return os.environ.get(ENV_API_KEY, "").strip()


def enabled() -> bool:
    """True when a gateway base URL is configured (regardless of the key)."""
    return bool(base_url())


def configured() -> bool:
    """True when the gateway can actually be called (base URL + master key)."""
    return bool(base_url() and api_key())


def chat_completions_url() -> str:
    """OpenAI-compatible completions endpoint on the gateway."""
    return f"{base_url()}/chat/completions"


def headers() -> dict[str, str]:
    """Auth headers for the gateway. Never contains prompts or logs the key."""
    headers = {"Content-Type": "application/json"}
    key = api_key()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


ENV_CALL_TAGS = "SMARTJUDGE_LLM_CALL_TAGS"
# Keys the key-pool cost_logger whitelists; nothing else from metadata is ever logged.
TAG_FIELDS = ("answer_id", "feature", "tenant", "plan")
_TAG_SAFE = re.compile(r"[^A-Za-z0-9._:-]")
_TAG_MAX = 64
_call_ctx: contextvars.ContextVar[dict[str, str] | None] = contextvars.ContextVar(
    "roxira_llm_call_ctx", default=None
)


def _clean_tag(value: object) -> str:
    """Short ASCII id only: anything else (Persian text, spaces, quotes) is dropped."""
    if value is None:
        return ""
    return _TAG_SAFE.sub("", str(value))[:_TAG_MAX]


def new_answer_id() -> str:
    return uuid.uuid4().hex


@contextlib.contextmanager
def call_context(**fields: object):
    """Attach answer_id/feature/tenant/plan to every gateway call made inside the block.

    Nested blocks add to (and override) the outer fields. Unknown field names are ignored.
    """
    merged = dict(_call_ctx.get() or {})
    for name, value in fields.items():
        cleaned = _clean_tag(value)
        if name in TAG_FIELDS and cleaned:
            merged[name] = cleaned
    token = _call_ctx.set(merged)
    try:
        yield merged
    finally:
        _call_ctx.reset(token)


def call_tags(**overrides: object) -> dict[str, str]:
    """The current context's tags plus explicit overrides, as ``roxira_<field>`` keys."""
    merged = dict(_call_ctx.get() or {})
    for name, value in overrides.items():
        cleaned = _clean_tag(value)
        if name in TAG_FIELDS and cleaned:
            merged[name] = cleaned
    return {f"roxira_{name}": merged[name] for name in TAG_FIELDS if merged.get(name)}


def tag(body: dict, **overrides: object) -> dict:
    """Add the cost-attribution ``metadata`` to a gateway request body (in place; returned).

    Only for bodies sent to the key-pool gateway: the direct OpenRouter path never gets it.
    """
    if os.environ.get(ENV_CALL_TAGS, "").strip().lower() not in ("1", "true", "yes", "on"):
        return body
    tags = call_tags(**overrides)
    if tags:
        meta = body.get("metadata")
        body["metadata"] = {**(meta if isinstance(meta, dict) else {}), **tags}
    return body


def log_served(path: str, model_name: str | None) -> None:
    """INFO: which path served an answer. Never logs prompts or keys."""
    logger.info("llm answer served path=%s model=%s", path, model_name or "-")


_PERSIAN = re.compile(r"[؀-ۿ]")
_LATIN = re.compile(r"[A-Za-z]")
_HEADING = re.compile(r"^\s*(?:#+\s*|\*\*\s*)?(?:خلاصه|پاسخ|مبنای قانونی)")


def strip_leaked_reasoning(text: str) -> str:
    """Drop an English "thinking" preamble some free models put before the Persian answer.

    Only removes text that comes BEFORE a Persian heading line (خلاصه / پاسخ / مبنای قانونی)
    and is mostly Latin letters, e.g. "Need answer in Persian, structured four headings ...".
    Anything else is returned unchanged.
    """
    if not text:
        return text
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if _HEADING.match(line):
            if i == 0:
                return text
            prefix = "\n".join(lines[:i])
            latin, persian = len(_LATIN.findall(prefix)), len(_PERSIAN.findall(prefix))
            if latin > 20 and latin > 2 * persian:
                return "\n".join(lines[i:]).strip()
            return text
    return text
