"""Unit tests for T236: LLM router hygiene (effort pins, static prefix, per-user caps)."""
from __future__ import annotations

from output_apps.generated_modules.smartjudge.llm_router_hygiene import (
    RATE_LIMIT_MESSAGE_5M_FA,
    RATE_LIMIT_MESSAGE_DAILY_FA,
    STATIC_LEGAL_SYSTEM_PREFIX,
    WINDOW_5M_SECONDS,
    WINDOW_DAILY_SECONDS,
    PerUserRateLimiter,
    build_cacheable_messages,
    build_reasoning_params,
    extract_cached_tokens,
)


class _FakeRedis:
    def __init__(self):
        self.counts: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    def expire(self, key: str, ttl: int) -> bool:
        self.ttls[key] = ttl
        return True

    def ttl(self, key: str) -> int:
        return self.ttls.get(key, -1)


def test_reasoning_effort_pins_default_low_and_override(monkeypatch):
    assert build_reasoning_params("google/gemini-family") == {"reasoning": {"effort": "low"}}
    assert build_reasoning_params("deepseek/deepseek-family") == {"reasoning": {"effort": "low"}}
    monkeypatch.setenv("SMARTJUDGE_REASONING_EFFORT", "none")
    assert build_reasoning_params("google/gemini-family") == {"reasoning": {"effort": "none"}}


def test_static_prefix_is_first_and_invariant_across_queries():
    assert len(STATIC_LEGAL_SYSTEM_PREFIX) >= 1000
    m1 = build_cacheable_messages("ماده ۵۲۲ قانون آیین دادرسی مدنی", "خسارت تاخیر تادیه چیست؟")
    m2 = build_cacheable_messages("ماده ۱۰ قانون مدنی", "اصل آزادی قراردادها چیست؟")
    assert m1[0]["role"] == "system"
    assert m1[0]["content"] == m2[0]["content"] == STATIC_LEGAL_SYSTEM_PREFIX
    assert m1[-1]["role"] == "user"
    assert "ماده ۵۲۲" in m1[-1]["content"]
    assert "خسارت تاخیر تادیه" in m1[-1]["content"]
    assert m1[-1]["content"].index("ماده ۵۲۲") < m1[-1]["content"].index("خسارت تاخیر تادیه")


def test_cacheable_messages_with_history_and_cache_control():
    msgs = build_cacheable_messages(
        "متن ماده ۱",
        "سوال جدید",
        history=[{"role": "user", "content": "سلام"}, {"role": "assistant", "content": "بفرمایید"}],
        enable_cache_control=True,
    )
    assert len(msgs) == 4
    assert msgs[0]["role"] == "system"
    assert msgs[0]["content"][0]["cache_control"] == {"type": "ephemeral"}
    assert msgs[1]["role"] == "user" and msgs[2]["role"] == "assistant"
    assert msgs[3]["role"] == "user" and "متن ماده ۱" in msgs[3]["content"]


def test_extract_cached_tokens_supports_openai_and_anthropic_shapes():
    assert extract_cached_tokens({"prompt_tokens_details": {"cached_tokens": 1150}}) == 1150
    assert extract_cached_tokens({"cache_read_input_tokens": 980}) == 980
    assert extract_cached_tokens({}) == 0
    assert extract_cached_tokens(None) == 0


def test_per_user_cap_5m_enforces_6_and_returns_persian_429():
    now = [1_000_000.0]
    limiter = PerUserRateLimiter(limit_5m=6, limit_daily=30, clock=lambda: now[0])
    for _ in range(6):
        res = limiter.check_and_increment("user-1")
        assert res.allowed is True
        assert res.status_code == 200
    blocked = limiter.check_and_increment("user-1")
    assert blocked.allowed is False
    assert blocked.status_code == 429
    assert blocked.scope == "5m"
    assert blocked.message_fa == RATE_LIMIT_MESSAGE_5M_FA
    assert blocked.retry_after_s > 0


def test_per_user_cap_daily_enforces_30_across_5m_windows():
    now = [2_000_000.0]
    limiter = PerUserRateLimiter(limit_5m=6, limit_daily=30, clock=lambda: now[0])
    for window in range(5):
        for _ in range(6):
            res = limiter.check_and_increment("user-2")
            assert res.allowed is True
        now[0] += WINDOW_5M_SECONDS + 1
    blocked = limiter.check_and_increment("user-2")
    assert blocked.allowed is False
    assert blocked.status_code == 429
    assert blocked.scope == "daily"
    assert blocked.message_fa == RATE_LIMIT_MESSAGE_DAILY_FA


def test_per_user_cap_redis_keys_and_ttls():
    fake = _FakeRedis()
    limiter = PerUserRateLimiter(redis_client=fake, limit_5m=2, limit_daily=10)
    assert limiter.check_and_increment("u42").allowed is True
    assert fake.ttls["smartjudge:cap:5m:u42"] == WINDOW_5M_SECONDS
    assert fake.ttls["smartjudge:cap:day:u42"] == WINDOW_DAILY_SECONDS
    assert limiter.check_and_increment("u42").allowed is True
    blocked = limiter.check_and_increment("u42")
    assert blocked.allowed is False
    assert blocked.status_code == 429
