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
    KEYPOOL_MASTER_KEY            gateway auth, sent as the OpenAI api key.

This module never makes a network call and never logs a key. Callers keep their
existing direct OpenRouter path as the fallback when the gateway fails, so chat
never breaks.
"""

from __future__ import annotations

import logging
import os
import re

logger = logging.getLogger("llm_gateway")

ENV_GATEWAY = "SMARTJUDGE_LLM_GATEWAY"
ENV_MODEL = "SMARTJUDGE_LLM_GATEWAY_MODEL"
ENV_API_KEY = "KEYPOOL_MASTER_KEY"
DEFAULT_MODEL = "agent-strong-free"


def base_url() -> str:
    """Configured gateway base URL (no trailing slash), or "" when unset."""
    return os.environ.get(ENV_GATEWAY, "").strip().rstrip("/")


def model() -> str:
    """Gateway group to ask for (default ``agent-strong-free``)."""
    return os.environ.get(ENV_MODEL, "").strip() or DEFAULT_MODEL


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
